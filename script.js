'use strict';

/* =========================================================
 * Infinity Core Defense — script.js（第3段階）
 *
 * 実装範囲:
 *   第1段階: エンジン / 描画 / 敵出現 / 自動攻撃 / 当たり判定 / Wave進行
 *   第2段階: アップグレード / ショップ / UI
 *   第3段階: 敵種類追加 / ボス / 特殊攻撃 / エフェクト / サウンド
 *     - 敵: 通常・高速・大型・遠距離・ボス（データ駆動 + behavior分岐）
 *     - 特殊攻撃: オーブ / 地雷 / ショックウェーブ / 防御壁 / ガーリック
 *     - 演出: 画面揺れ / ヒットストップ / 画面フラッシュ / ボス登場演出
 *     - サウンド: レーザー・着弾・爆発・レベルアップ・ボス・GO・BGM
 *     - 図鑑（第4段階の本実装に先行して敵データ表示のみ）
 *
 * 設計方針:
 *   - 敵もアップグレードも配列へデータ追加するだけで機能する
 *   - 全エンティティはオブジェクトプール + swap-remove
 * ======================================================= */

/* =========================================================
 * 1. 定数
 * ======================================================= */

const CONFIG = Object.freeze({
  DPR_MAX: 2,
  CORE_RADIUS: 26,
  SPAWN_MARGIN: 50,
  PROJECTILE_SPEED: 760,
  PROJECTILE_LIFE: 2.0,
  ENEMY_PROJECTILE_SPEED: 210,
  WAVE_INTERMISSION: 1.3,
  MAX_DT: 0.05,
  HUD_UPDATE_INTERVAL: 0.1,
  SHOP_UPDATE_INTERVAL: 0.15,
  ARMOR_BREAK_DURATION: 3.0,
  RAPID_FIRE_RATE: 0.25,

  BOSS_INTERVAL: 50,          // 何Wave毎にボスを出すか
  BOSS_WARNING_TIME: 1.6,     // ボス出現警告の表示時間

  WALL_RADIUS: 52,            // 防御壁の半径
  ORB_RADIUS: 78,             // オーブの周回半径
  ORB_SIZE: 7,
  MINE_INTERVAL: 2.2,         // 地雷の設置間隔
  MINE_MAX: 12,
  GARLIC_RADIUS: 90,          // ガーリックの効果範囲
  PACKAGE_LIFE: 8.0,
  PACKAGE_PICKUP_RADIUS: 999, // 自動回収（時間経過で取得）

  HITSTOP_SCALE: 0.12,        // ヒットストップ中の時間倍率
  SHAKE_MAX: 14,
});

/** プレイヤー基礎ステータス（UPGRADESのeffectが加算していく土台） */
const BASE_STATS = Object.freeze({
  // 攻撃
  damage: 5,
  attackInterval: 0.45,
  range: 175,
  critChance: 0,
  critMultiplier: 1.5,
  superCritChance: 0,
  superCritMultiplier: 3.0,
  damagePerMeter: 0,
  multishotChance: 0,
  multishotTargets: 2,
  rapidFireChance: 0,
  rapidFireDuration: 1.5,
  bounceChance: 0,
  bounceCount: 1,
  bounceRange: 120,
  armorBreakChance: 0,
  armorBreakMultiplier: 1.25,
  // 防御
  maxHp: 100,
  hpRegen: 0,
  defense: 0,
  orbCount: 0,
  orbDamage: 0,
  orbSpeed: 1.6,              // rad/s
  orbBossDamage: 0,           // ボス最大HPに対する割合ダメージ
  mineDamage: 0,
  mineDecay: 3.0,             // 設置から爆発までの時間
  shockwaveSize: 60,
  wallHealth: 0,
  wallRegen: 0,
  wallInvincible: 0.4,        // 被弾後の無敵時間
  wallThorns: 0,
  wallFortification: 1,       // 壁最大耐久の倍率
  garlicThorns: 0,            // 範囲内DoT (dmg/s)
  // ユーティリティ
  cashBonus: 1,
  cashPerWave: 0,
  coinPerKill: 0,
  coinPerWave: 0,
  interest: 0,
  maxInterestCap: 100,
  enemyAttackSkip: 0,
  enemyHpSkip: 0,
  bossPackage: 0,             // ボス撃破時のパッケージ数
  packageChance: 0,           // 通常敵のパッケージドロップ率
  packageHeal: 0.05,          // パッケージ1個の回復割合
  packageMax: 3,              // 同時存在数の上限
});

/* =========================================================
 * 2. データ定義（Data Driven Design）
 * ======================================================= */

/**
 * 敵データ。オブジェクトを1つ追加するだけで出現抽選・図鑑へ反映される。
 *   behavior : 'charge'（直進突撃） | 'ranged'（一定距離で停止し射撃）
 *   boss     : true でボス扱い（ボスWaveのみ出現・専用HPバー・演出）
 *   shape    : 'circle' | 'triangle' | 'square' | 'hex'
 */
const ENEMY_TYPES = [
  {
    id: 'normal', name: 'ドローン', desc: '標準的な小型機。数で押し寄せる',
    color: '#ff3b6b', glow: 'rgba(255,59,107,0.6)', shape: 'circle',
    size: 11, baseHp: 14, baseAtk: 8, baseSpeed: 44,
    cash: 5, coin: 0, exp: 1,
    behavior: 'charge', weight: 100, minWave: 1,
  },
  {
    id: 'fast', name: 'スカウト', desc: '装甲は薄いが極めて高速',
    color: '#3dff9e', glow: 'rgba(61,255,158,0.6)', shape: 'triangle',
    size: 9, baseHp: 8, baseAtk: 6, baseSpeed: 96,
    cash: 7, coin: 0, exp: 2,
    behavior: 'charge', weight: 45, minWave: 4,
  },
  {
    id: 'tank', name: 'ジャガーノート', desc: '重装甲の大型機。低速だが高耐久',
    color: '#ffc233', glow: 'rgba(255,194,51,0.6)', shape: 'square',
    size: 19, baseHp: 62, baseAtk: 22, baseSpeed: 26,
    cash: 18, coin: 0, exp: 5,
    behavior: 'charge', weight: 30, minWave: 8,
  },
  {
    id: 'ranged', name: 'アーティラリー', desc: '射程外から砲撃してくる支援機',
    color: '#a561ff', glow: 'rgba(165,97,255,0.6)', shape: 'hex',
    size: 13, baseHp: 26, baseAtk: 14, baseSpeed: 34,
    cash: 14, coin: 0, exp: 4,
    behavior: 'ranged', stopDistance: 230, fireInterval: 2.4,
    weight: 28, minWave: 14,
  },
  {
    id: 'boss', name: 'コロッサス', desc: '50Wave毎に現れる超大型個体',
    color: '#ff2d95', glow: 'rgba(255,45,149,0.8)', shape: 'hex',
    size: 46, baseHp: 2600, baseAtk: 120, baseSpeed: 17,
    cash: 900, coin: 3, exp: 100,
    behavior: 'charge', boss: true, weight: 0, minWave: 50,
  },
];

/** Waveスケーリング規則 */
const WAVE_RULES = Object.freeze({
  enemyCount: (w) => Math.min(6 + Math.floor(w * 1.4), 55),
  hpMul: (w) =>
    Math.pow(1.10, w - 1) * (w > 100 ? Math.pow(1.02, w - 100) : 1),
  atkMul: (w) =>
    Math.pow(1.055, w - 1) * (w > 100 ? Math.pow(1.01, w - 100) : 1),
  speedMul: (w) => Math.min(1 + (w - 1) * 0.008, 2.4),
  cashMul: (w) => 1 + (w - 1) * 0.15,
  spawnInterval: (w) => Math.max(0.85 - w * 0.012, 0.16),
  isBossWave: (w) => w % CONFIG.BOSS_INTERVAL === 0,
});

/**
 * アップグレード定義。ショップはこの配列から自動生成される。
 * 追加時はオブジェクトを1つ足すだけでよい。
 */
const UPGRADES = [
  /* ---------------- 攻撃 ---------------- */
  {
    id: 'damage', name: 'Damage', category: 'attack',
    level: 0, maxLevel: 6000, baseCost: 8, growth: 1.08,
    description: '攻撃力が増加',
    effect(s, lv) { s.damage += lv * 2; },
    valueText: (lv) => '+' + formatNumber(lv * 2),
  },
  {
    id: 'attackSpeed', name: 'Attack Speed', category: 'attack',
    level: 0, maxLevel: 99, baseCost: 30, growth: 1.22,
    description: '攻撃速度が上昇',
    effect(s, lv) { s.attackInterval = BASE_STATS.attackInterval / (1 + lv * 0.04); },
    valueText: (lv) => '+' + (lv * 4) + '%',
  },
  {
    id: 'critChance', name: 'Critical Chance', category: 'attack',
    level: 0, maxLevel: 80, baseCost: 50, growth: 1.18,
    description: 'クリティカル発生率（最大80%）',
    effect(s, lv) { s.critChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'critDamage', name: 'Critical Damage', category: 'attack',
    level: 0, maxLevel: 150, baseCost: 80, growth: 1.16,
    description: 'クリティカル倍率が上昇',
    effect(s, lv) { s.critMultiplier += lv * 0.05; },
    valueText: (lv) => 'x' + (1.5 + lv * 0.05).toFixed(2),
  },
  {
    id: 'attackRange', name: 'Attack Range', category: 'attack',
    level: 0, maxLevel: 79, baseCost: 60, growth: 1.19,
    description: '攻撃範囲が拡大',
    effect(s, lv) { s.range += lv * 4; },
    valueText: (lv) => (175 + lv * 4) + '',
  },
  {
    id: 'damagePerMeter', name: 'Damage Per Meter', category: 'attack',
    level: 0, maxLevel: 100, baseCost: 120, growth: 1.20,
    description: '遠い敵ほどダメージ上昇',
    effect(s, lv) { s.damagePerMeter += lv * 0.02; },
    valueText: (lv) => '+' + (lv * 2) + '%/100px',
  },
  {
    id: 'multishotChance', name: 'Multishot Chance', category: 'attack',
    level: 0, maxLevel: 40, baseCost: 200, growth: 1.25,
    description: '複数の敵へ同時攻撃する確率',
    effect(s, lv) { s.multishotChance += lv * 0.02; },
    valueText: (lv) => (lv * 2) + '%',
  },
  {
    id: 'multishotTargets', name: 'Multishot Targets', category: 'attack',
    level: 0, maxLevel: 5, baseCost: 1000, growth: 1.9,
    description: '同時攻撃数（最大7体）',
    effect(s, lv) { s.multishotTargets += lv; },
    valueText: (lv) => (2 + lv) + '体',
  },
  {
    id: 'rapidFireChance', name: 'Rapid Fire Chance', category: 'attack',
    level: 0, maxLevel: 50, baseCost: 300, growth: 1.24,
    description: '高速連射モード発動率',
    effect(s, lv) { s.rapidFireChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'rapidFireDuration', name: 'Rapid Fire Duration', category: 'attack',
    level: 0, maxLevel: 20, baseCost: 400, growth: 1.35,
    description: '高速連射の持続時間',
    effect(s, lv) { s.rapidFireDuration += lv * 0.25; },
    valueText: (lv) => (1.5 + lv * 0.25).toFixed(2) + 's',
  },
  {
    id: 'bounceChance', name: 'Bounce Chance', category: 'attack',
    level: 0, maxLevel: 40, baseCost: 250, growth: 1.25,
    description: '弾が別の敵へ跳弾する確率',
    effect(s, lv) { s.bounceChance += lv * 0.02; },
    valueText: (lv) => (lv * 2) + '%',
  },
  {
    id: 'bounceCount', name: 'Bounce Count', category: 'attack',
    level: 0, maxLevel: 6, baseCost: 800, growth: 1.9,
    description: '跳弾回数（最大7回）',
    effect(s, lv) { s.bounceCount += lv; },
    valueText: (lv) => (1 + lv) + '回',
  },
  {
    id: 'bounceRange', name: 'Bounce Range', category: 'attack',
    level: 0, maxLevel: 30, baseCost: 350, growth: 1.3,
    description: '跳弾の索敵距離',
    effect(s, lv) { s.bounceRange += lv * 8; },
    valueText: (lv) => (120 + lv * 8) + '',
  },
  {
    id: 'superCritChance', name: 'Super Crit Chance', category: 'attack',
    level: 0, maxLevel: 30, baseCost: 1500, growth: 1.35,
    description: 'クリティカルがスーパー化する確率',
    effect(s, lv) { s.superCritChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'superCritDamage', name: 'Super Crit Damage', category: 'attack',
    level: 0, maxLevel: 100, baseCost: 2000, growth: 1.3,
    description: 'スーパークリティカル倍率',
    effect(s, lv) { s.superCritMultiplier += lv * 0.1; },
    valueText: (lv) => 'x' + (3 + lv * 0.1).toFixed(1),
  },
  {
    id: 'armorBreakChance', name: 'Armor Break Chance', category: 'attack',
    level: 0, maxLevel: 50, baseCost: 600, growth: 1.28,
    description: '敵の防御を低下させる確率',
    effect(s, lv) { s.armorBreakChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'armorBreakMult', name: 'Armor Break Multiplier', category: 'attack',
    level: 0, maxLevel: 50, baseCost: 800, growth: 1.3,
    description: '防御低下中の被ダメージ倍率',
    effect(s, lv) { s.armorBreakMultiplier += lv * 0.03; },
    valueText: (lv) => 'x' + (1.25 + lv * 0.03).toFixed(2),
  },

  /* ---------------- 防御 ---------------- */
  {
    id: 'health', name: 'Health', category: 'defense',
    level: 0, maxLevel: 2000, baseCost: 12, growth: 1.10,
    description: '最大HPが増加',
    effect(s, lv) { s.maxHp += lv * 20; },
    valueText: (lv) => formatNumber(100 + lv * 20),
  },
  {
    id: 'healthRegen', name: 'Health Regen', category: 'defense',
    level: 0, maxLevel: 200, baseCost: 40, growth: 1.18,
    description: 'HPが毎秒自動回復',
    effect(s, lv) { s.hpRegen += lv * 0.5; },
    valueText: (lv) => '+' + (lv * 0.5).toFixed(1) + '/s',
  },
  {
    id: 'defense', name: 'Defense', category: 'defense',
    level: 0, maxLevel: 500, baseCost: 60, growth: 1.16,
    description: '被ダメージを軽減',
    effect(s, lv) { s.defense += lv; },
    valueText: (lv) => '-' + formatNumber(lv),
  },
  {
    id: 'orbCount', name: 'Orb', category: 'defense',
    level: 0, maxLevel: 8, baseCost: 500, growth: 2.1,
    description: '周回する防衛オーブを展開',
    effect(s, lv) { s.orbCount += lv; },
    valueText: (lv) => lv + '基',
  },
  {
    id: 'orbDamage', name: 'Orb Damage', category: 'defense',
    level: 0, maxLevel: 500, baseCost: 200, growth: 1.15,
    description: 'オーブの接触ダメージ',
    effect(s, lv) { s.orbDamage += lv * 6; },
    valueText: (lv) => formatNumber(lv * 6),
  },
  {
    id: 'orbSpeed', name: 'Orb Speed', category: 'defense',
    level: 0, maxLevel: 60, baseCost: 300, growth: 1.2,
    description: 'オーブの回転速度',
    effect(s, lv) { s.orbSpeed += lv * 0.08; },
    valueText: (lv) => (1.6 + lv * 0.08).toFixed(2) + ' rad/s',
  },
  {
    id: 'orbBossDamage', name: 'Orb Boss Damage', category: 'defense',
    level: 0, maxLevel: 40, baseCost: 2500, growth: 1.35,
    description: 'オーブがボスへ割合ダメージ',
    effect(s, lv) { s.orbBossDamage += lv * 0.001; },
    valueText: (lv) => (lv * 0.1).toFixed(1) + '%/hit',
  },
  {
    id: 'mineDamage', name: 'Mine Damage', category: 'defense',
    level: 0, maxLevel: 500, baseCost: 400, growth: 1.16,
    description: '自動設置される地雷の威力',
    effect(s, lv) { s.mineDamage += lv * 14; },
    valueText: (lv) => formatNumber(lv * 14),
  },
  {
    id: 'mineDecay', name: 'Mine Decay', category: 'defense',
    level: 0, maxLevel: 40, baseCost: 350, growth: 1.22,
    description: '地雷の起爆までの時間を短縮',
    effect(s, lv) { s.mineDecay = Math.max(3.0 - lv * 0.06, 0.5); },
    valueText: (lv) => Math.max(3.0 - lv * 0.06, 0.5).toFixed(2) + 's',
  },
  {
    id: 'shockwaveSize', name: 'Shockwave Size', category: 'defense',
    level: 0, maxLevel: 60, baseCost: 450, growth: 1.2,
    description: '爆発の範囲が拡大',
    effect(s, lv) { s.shockwaveSize += lv * 4; },
    valueText: (lv) => (60 + lv * 4) + '',
  },
  {
    id: 'wallHealth', name: 'Wall Health', category: 'defense',
    level: 0, maxLevel: 1000, baseCost: 600, growth: 1.14,
    description: 'コアを覆う防御壁を展開',
    effect(s, lv) { s.wallHealth += lv * 40; },
    valueText: (lv) => formatNumber(lv * 40),
  },
  {
    id: 'wallRegen', name: 'Wall Regen', category: 'defense',
    level: 0, maxLevel: 200, baseCost: 500, growth: 1.18,
    description: '防御壁が毎秒回復',
    effect(s, lv) { s.wallRegen += lv * 2; },
    valueText: (lv) => '+' + formatNumber(lv * 2) + '/s',
  },
  {
    id: 'wallInvincible', name: 'Wall Invincible', category: 'defense',
    level: 0, maxLevel: 30, baseCost: 900, growth: 1.3,
    description: '壁の被弾後の無敵時間',
    effect(s, lv) { s.wallInvincible += lv * 0.04; },
    valueText: (lv) => (0.4 + lv * 0.04).toFixed(2) + 's',
  },
  {
    id: 'wallThorns', name: 'Wall Thorns', category: 'defense',
    level: 0, maxLevel: 300, baseCost: 700, growth: 1.16,
    description: '壁に触れた敵へ反射ダメージ',
    effect(s, lv) { s.wallThorns += lv * 10; },
    valueText: (lv) => formatNumber(lv * 10),
  },
  {
    id: 'wallFortification', name: 'Wall Fortification', category: 'defense',
    level: 0, maxLevel: 50, baseCost: 1200, growth: 1.3,
    description: '壁の最大耐久を倍率で強化',
    effect(s, lv) { s.wallFortification += lv * 0.1; },
    valueText: (lv) => 'x' + (1 + lv * 0.1).toFixed(1),
  },
  {
    id: 'garlicThorns', name: 'Garlic Thorns', category: 'defense',
    level: 0, maxLevel: 300, baseCost: 800, growth: 1.16,
    description: '近接した敵へ継続ダメージ',
    effect(s, lv) { s.garlicThorns += lv * 8; },
    valueText: (lv) => formatNumber(lv * 8) + '/s',
  },

  /* ---------------- ユーティリティ ---------------- */
  {
    id: 'cashBonus', name: 'Cash Bonus', category: 'utility',
    level: 0, maxLevel: 200, baseCost: 100, growth: 1.22,
    description: '獲得Cashが増加',
    effect(s, lv) { s.cashBonus += lv * 0.05; },
    valueText: (lv) => '+' + (lv * 5) + '%',
  },
  {
    id: 'cashPerWave', name: 'Cash Per Wave', category: 'utility',
    level: 0, maxLevel: 100, baseCost: 150, growth: 1.25,
    description: 'Waveクリア時にCash獲得',
    effect(s, lv) { s.cashPerWave += lv * 10; },
    valueText: (lv) => '+$' + formatNumber(lv * 10),
  },
  {
    id: 'coinPerKill', name: 'Coin Per Kill', category: 'utility',
    level: 0, maxLevel: 50, baseCost: 500, growth: 1.35,
    description: '撃破時にCoin獲得（期待値）',
    effect(s, lv) { s.coinPerKill += lv * 0.01; },
    valueText: (lv) => (lv * 0.01).toFixed(2) + '/kill',
  },
  {
    id: 'coinPerWave', name: 'Coin Per Wave', category: 'utility',
    level: 0, maxLevel: 50, baseCost: 800, growth: 1.4,
    description: 'Waveクリア時にCoin獲得',
    effect(s, lv) { s.coinPerWave += lv * 0.2; },
    valueText: (lv) => '+' + (lv * 0.2).toFixed(1) + '◎',
  },
  {
    id: 'interest', name: 'Interest', category: 'utility',
    level: 0, maxLevel: 30, baseCost: 400, growth: 1.4,
    description: 'Waveクリア時に所持Cashの利息',
    effect(s, lv) { s.interest += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'maxInterest', name: 'Max Interest', category: 'utility',
    level: 0, maxLevel: 50, baseCost: 600, growth: 1.35,
    description: '利息の上限額が増加',
    effect(s, lv) { s.maxInterestCap += lv * 250; },
    valueText: (lv) => '$' + formatNumber(100 + lv * 250),
  },
  {
    id: 'bossPackage', name: 'Boss Package', category: 'utility',
    level: 0, maxLevel: 20, baseCost: 1200, growth: 1.4,
    description: 'ボス撃破時に補給パッケージ',
    effect(s, lv) { s.bossPackage += lv; },
    valueText: (lv) => lv + '個',
  },
  {
    id: 'packageChance', name: 'Package Chance', category: 'utility',
    level: 0, maxLevel: 40, baseCost: 700, growth: 1.3,
    description: '敵がパッケージを落とす確率',
    effect(s, lv) { s.packageChance += lv * 0.005; },
    valueText: (lv) => (lv * 0.5).toFixed(1) + '%',
  },
  {
    id: 'packageHeal', name: 'Package Heal', category: 'utility',
    level: 0, maxLevel: 50, baseCost: 500, growth: 1.28,
    description: 'パッケージのHP回復量',
    effect(s, lv) { s.packageHeal += lv * 0.01; },
    valueText: (lv) => ((0.05 + lv * 0.01) * 100).toFixed(0) + '%',
  },
  {
    id: 'packageMax', name: 'Package Max', category: 'utility',
    level: 0, maxLevel: 12, baseCost: 900, growth: 1.45,
    description: '同時に存在できるパッケージ数',
    effect(s, lv) { s.packageMax += lv; },
    valueText: (lv) => (3 + lv) + '個',
  },
  {
    id: 'enemyAttackSkip', name: 'Enemy Attack Skip', category: 'utility',
    level: 0, maxLevel: 40, baseCost: 700, growth: 1.35,
    description: '敵の攻撃を無効化する確率',
    effect(s, lv) { s.enemyAttackSkip += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'enemyHpSkip', name: 'Enemy HP Skip', category: 'utility',
    level: 0, maxLevel: 40, baseCost: 900, growth: 1.35,
    description: '敵がHP半減で出現する確率',
    effect(s, lv) { s.enemyHpSkip += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
];

const SHOP_CATEGORIES = [
  { id: 'attack', label: '攻撃' },
  { id: 'defense', label: '防御' },
  { id: 'utility', label: '補助' },
];

const BUY_MULTIPLIERS = [1, 10, 100, 'MAX'];

/* =========================================================
 * 3. ユーティリティ
 * ======================================================= */

const TAU = Math.PI * 2;

function formatNumber(n) {
  if (n < 1000) {
    return Number.isInteger(n) ? n.toString() : n.toFixed(1);
  }
  const units = ['K', 'M', 'B', 'T', 'q', 'Q', 's', 'S'];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return v.toFixed(v < 100 ? 1 : 0) + units[u];
}

function upgradeCostAt(u, level) {
  return Math.floor(u.baseCost * Math.pow(u.growth, level));
}

function calcBuyPlan(u, cash, mult) {
  const remaining = u.maxLevel - u.level;
  if (remaining <= 0) return { count: 0, cost: 0 };
  const want = mult === 'MAX' ? remaining : Math.min(mult, remaining);
  let count = 0;
  let cost = 0;
  for (let i = 0; i < want; i++) {
    const c = upgradeCostAt(u, u.level + count);
    if (cost + c > cash) break;
    cost += c;
    count++;
  }
  if (count === 0) return { count: 0, cost: upgradeCostAt(u, u.level) };
  return { count, cost };
}

class Pool {
  constructor(factory, initialSize) {
    this._factory = factory;
    this._free = [];
    for (let i = 0; i < initialSize; i++) this._free.push(factory());
  }
  acquire() {
    return this._free.length > 0 ? this._free.pop() : this._factory();
  }
  release(obj) { this._free.push(obj); }
}

function swapRemove(arr, index) {
  const last = arr.length - 1;
  const obj = arr[index];
  arr[index] = arr[last];
  arr.pop();
  return obj;
}

/** 図形描画ヘルパー（敵の形状差別化に使用） */
function tracePolygon(ctx, x, y, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/* =========================================================
 * 4. サウンド（Web Audio・ライブラリ不使用）
 * ======================================================= */

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.bgmGain = null;
    this.bgmTimer = null;
    this.bgmStep = 0;
    // SEの多重再生を抑制するスロットル（発射音などが毎フレーム鳴るのを防ぐ）
    this._lastPlay = Object.create(null);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.16;
      this.bgmGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.9 : 0;
  }

  /** 同一キーのSEを最短間隔で制限 */
  _throttle(key, interval) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (this._lastPlay[key] && now - this._lastPlay[key] < interval) return false;
    this._lastPlay[key] = now;
    return true;
  }

  _tone(freq, start, dur, type, vol, endFreq, dest) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain).connect(dest || this.master);
    osc.start(start);
    osc.stop(start + dur);
  }

  /** ホワイトノイズ（爆発音の芯） */
  _noise(start, dur, vol, filterFreq) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(start);
  }

  laser() {
    if (!this.enabled || !this.ctx || !this._throttle('laser', 0.05)) return;
    const t = this.ctx.currentTime;
    this._tone(1250, t, 0.06, 'square', 0.028, 420);
  }
  hit() {
    if (!this.enabled || !this.ctx || !this._throttle('hit', 0.045)) return;
    const t = this.ctx.currentTime;
    this._tone(320, t, 0.05, 'triangle', 0.035, 180);
  }
  crit() {
    if (!this.enabled || !this.ctx || !this._throttle('crit', 0.08)) return;
    const t = this.ctx.currentTime;
    this._tone(880, t, 0.09, 'square', 0.05, 1600);
  }
  explosion() {
    if (!this.enabled || !this.ctx || !this._throttle('exp', 0.07)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.3, 0.16, 900);
    this._tone(120, t, 0.25, 'sine', 0.09, 40);
  }
  buy() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(620, t, 0.07, 'square', 0.07);
    this._tone(930, t + 0.06, 0.09, 'square', 0.07);
  }
  deny() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(160, t, 0.12, 'sawtooth', 0.06, 110);
  }
  waveClear() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(520, t, 0.08, 'triangle', 0.05);
    this._tone(780, t + 0.07, 0.12, 'triangle', 0.05);
  }
  package_() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(700, t, 0.06, 'sine', 0.06);
    this._tone(1050, t + 0.05, 0.1, 'sine', 0.06);
    this._tone(1400, t + 0.11, 0.12, 'sine', 0.05);
  }
  bossAppear() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // 下降する不穏なブラス風＋低音の唸り
    this._tone(220, t, 0.7, 'sawtooth', 0.09, 70);
    this._tone(110, t + 0.1, 1.0, 'square', 0.07, 55);
    this._noise(t, 0.6, 0.08, 500);
  }
  bossDefeat() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.8, 0.22, 1400);
    this._tone(160, t, 0.7, 'sine', 0.12, 40);
    this._tone(660, t + 0.15, 0.2, 'triangle', 0.07, 1320);
  }
  gameOver() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.stopBgm();
    this._tone(440, t, 0.35, 'sawtooth', 0.1, 220);
    this._tone(330, t + 0.3, 0.4, 'sawtooth', 0.1, 165);
    this._tone(220, t + 0.65, 0.9, 'sawtooth', 0.1, 60);
  }

  /* ---- ループBGM（16分音符のアルペジオを先読みスケジュール） ---- */
  startBgm() {
    if (!this.ctx || this.bgmTimer) return;
    // Aマイナー系の暗い進行（近未来感のある4小節ループ）
    this.bgmSeq = [
      110, 0, 165, 0, 220, 0, 165, 0,
      98,  0, 147, 0, 196, 0, 147, 0,
      123, 0, 185, 0, 247, 0, 185, 0,
      82,  0, 123, 0, 165, 0, 123, 0,
    ];
    this.bgmStep = 0;
    this.bgmNextTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx) return;
      const ahead = this.ctx.currentTime + 0.4;
      const stepDur = 0.16;
      while (this.bgmNextTime < ahead) {
        const f = this.bgmSeq[this.bgmStep % this.bgmSeq.length];
        if (f > 0) {
          this._tone(f, this.bgmNextTime, stepDur * 1.6, 'triangle', 0.5, null, this.bgmGain);
          // 1小節頭にサブベース
          if (this.bgmStep % 8 === 0) {
            this._tone(f / 2, this.bgmNextTime, stepDur * 3, 'sine', 0.6, null, this.bgmGain);
          }
        }
        this.bgmNextTime += stepDur;
        this.bgmStep++;
      }
    };
    tick();
    this.bgmTimer = setInterval(tick, 200);
  }

  stopBgm() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  /** ボス戦中はBGMの音量を上げて緊張感を出す */
  setBgmIntensity(high) {
    if (this.bgmGain) this.bgmGain.gain.value = high ? 0.24 : 0.16;
  }
}

/* =========================================================
 * 5. エンティティ
 * ======================================================= */

class Enemy {
  constructor() { this.reset(); }
  reset() {
    this.type = null;
    this.x = 0; this.y = 0;
    this.hp = 0; this.maxHp = 0;
    this.atk = 0;
    this.speed = 0;
    this.size = 0;
    this.cash = 0;
    this.coin = 0;
    this.exp = 0;
    this.hitFlash = 0;
    this.wobble = Math.random() * TAU;
    this.rotation = Math.random() * TAU;
    this.armorBreakTimer = 0;
    this.dmgTakenMul = 1;
    this.isBoss = false;
    this.fireTimer = 0;
    this.spawnAnim = 0;      // 出現時のスケールアニメーション
    this.wallContactCd = 0;  // 壁の反射ダメージのクールダウン
  }
  init(type, wave, x, y) {
    this.type = type;
    this.x = x; this.y = y;
    this.maxHp = type.baseHp * WAVE_RULES.hpMul(wave);
    this.hp = this.maxHp;
    this.atk = type.baseAtk * WAVE_RULES.atkMul(wave);
    this.speed = type.baseSpeed * WAVE_RULES.speedMul(wave);
    this.size = type.size;
    this.cash = Math.ceil(type.cash * WAVE_RULES.cashMul(wave));
    this.coin = type.coin;
    this.exp = type.exp;
    this.hitFlash = 0;
    this.armorBreakTimer = 0;
    this.dmgTakenMul = 1;
    this.isBoss = !!type.boss;
    this.fireTimer = type.fireInterval ? type.fireInterval * 0.6 : 0;
    this.spawnAnim = 0.4;
    this.wallContactCd = 0;
  }

  /**
   * 更新。中心までの距離を返す。
   * ranged型は stopDistance で停止し、fireInterval毎に弾を撃つ。
   */
  update(dt, game) {
    const dx = game.cx - this.x;
    const dy = game.cy - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    const type = this.type;
    let moving = true;
    if (type.behavior === 'ranged' && dist <= type.stopDistance) {
      moving = false;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = type.fireInterval;
        game.spawnEnemyProjectile(this);
      }
    }

    if (moving) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.spawnAnim > 0) this.spawnAnim -= dt;
    if (this.wallContactCd > 0) this.wallContactCd -= dt;
    if (this.armorBreakTimer > 0) {
      this.armorBreakTimer -= dt;
      if (this.armorBreakTimer <= 0) this.dmgTakenMul = 1;
    }
    this.wobble += dt * 4;
    this.rotation += dt * (this.isBoss ? 0.4 : 1.2);
    return dist;
  }
}

/** critTier: 0=通常 1=クリティカル 2=スーパークリティカル */
class Projectile {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.damage = 0;
    this.critTier = 0;
    this.target = null;
    this.life = 0;
    this.px = 0; this.py = 0;
    this.bouncesLeft = 0;
    this.bounceRange = 0;
  }
  init(x, y, target, damage, critTier, bouncesLeft, bounceRange) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.target = target;
    this.damage = damage;
    this.critTier = critTier;
    this.life = CONFIG.PROJECTILE_LIFE;
    this.bouncesLeft = bouncesLeft;
    this.bounceRange = bounceRange;
    this.aimAt(target.x, target.y);
  }
  aimAt(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * CONFIG.PROJECTILE_SPEED;
    this.vy = (dy / d) * CONFIG.PROJECTILE_SPEED;
  }
  update(dt) {
    this.px = this.x;
    this.py = this.y;
    const t = this.target;
    if (t && t.hp > 0) this.aimAt(t.x, t.y);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }
}

/** 遠距離敵が撃つ弾（コアへ直進） */
class EnemyProjectile {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.damage = 0;
    this.life = 0;
    this.color = '#a561ff';
  }
  init(x, y, cx, cy, damage, color) {
    this.x = x; this.y = y;
    this.damage = damage;
    this.color = color;
    this.life = 6;
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * CONFIG.ENEMY_PROJECTILE_SPEED;
    this.vy = (dy / d) * CONFIG.ENEMY_PROJECTILE_SPEED;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }
}

class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.life = 0; this.maxLife = 0;
    this.size = 0;
    this.color = '#fff';
  }
  init(x, y, vx, vy, life, size, color) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size;
    this.color = color;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.92;
    this.vy *= 0.92;
    this.life -= dt;
  }
}

class DamageNumber {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.text = '';
    this.life = 0; this.maxLife = 0;
    this.critTier = 0;
  }
  init(x, y, value, critTier) {
    this.x = x + (Math.random() - 0.5) * 14;
    this.y = y - 6;
    this.text = formatNumber(value);
    this.maxLife = critTier === 2 ? 1.0 : critTier === 1 ? 0.8 : 0.55;
    this.life = this.maxLife;
    this.critTier = critTier;
  }
  update(dt) {
    this.y -= 42 * dt;
    this.life -= dt;
  }
}

/** 地雷（自動設置され、時間経過または接触で爆発） */
class Mine {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.timer = 0;
    this.damage = 0;
    this.radius = 0;
    this.pulse = 0;
  }
  init(x, y, timer, damage, radius) {
    this.x = x; this.y = y;
    this.timer = timer;
    this.damage = damage;
    this.radius = radius;
    this.pulse = 0;
  }
  update(dt) {
    this.timer -= dt;
    this.pulse += dt * 8;
  }
}

/** ショックウェーブ（爆発の視覚表現） */
class Shockwave {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.radius = 0;
    this.maxRadius = 0;
    this.life = 0; this.maxLife = 0;
    this.color = '#ffc233';
  }
  init(x, y, maxRadius, color) {
    this.x = x; this.y = y;
    this.radius = 0;
    this.maxRadius = maxRadius;
    this.maxLife = 0.36;
    this.life = this.maxLife;
    this.color = color;
  }
  update(dt) {
    this.life -= dt;
    const t = 1 - this.life / this.maxLife;
    this.radius = this.maxRadius * (1 - Math.pow(1 - t, 2)); // イーズアウト
  }
}

/** 補給パッケージ（HP回復＋Cash） */
class Package {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.life = 0;
    this.rotation = 0;
    this.cash = 0;
  }
  init(x, y, cash) {
    this.x = x; this.y = y;
    const a = Math.random() * TAU;
    this.vx = Math.cos(a) * 30;
    this.vy = Math.sin(a) * 30;
    this.life = CONFIG.PACKAGE_LIFE;
    this.rotation = 0;
    this.cash = cash;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.94;
    this.vy *= 0.94;
    this.rotation += dt * 2;
    this.life -= dt;
  }
}

/* =========================================================
 * 6. プレイヤー（中央コア）
 * ======================================================= */

class Player {
  constructor(game) {
    this.game = game;
    this.rotation = 0;
    this.attackCooldown = 0;
    this.pulse = 0;
    this.hp = 0;
    this.hurtFlash = 0;
    this.rapidFireTimer = 0;
    // 防御壁
    this.wallHp = 0;
    this.wallInvincibleTimer = 0;
    this.wallFlash = 0;
    // オーブ
    this.orbAngle = 0;
    // 地雷
    this.mineTimer = 0;
    // ガーリック（DoTの適用間隔）
    this.garlicTimer = 0;

    this._targetBuf = [];
    this._targetDist = [];
    this.recalc();
    this.hp = this.stats.maxHp;
    this.wallHp = this.maxWallHp;
  }

  get maxWallHp() {
    return this.stats.wallHealth * this.stats.wallFortification;
  }

  /** データ駆動の中核: BASE_STATSへ全UPGRADEのeffectを適用 */
  recalc() {
    const prevMaxHp = this.stats ? this.stats.maxHp : BASE_STATS.maxHp;
    const prevMaxWall = this.stats ? this.maxWallHp : 0;

    const s = Object.assign({}, BASE_STATS);
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      if (u.level > 0) u.effect(s, u.level);
    }
    this.stats = s;

    const hpGain = s.maxHp - prevMaxHp;
    if (hpGain > 0) this.hp += hpGain;
    if (this.hp > s.maxHp) this.hp = s.maxHp;

    const wallGain = this.maxWallHp - prevMaxWall;
    if (wallGain > 0) this.wallHp += wallGain;
    if (this.wallHp > this.maxWallHp) this.wallHp = this.maxWallHp;
  }

  update(dt) {
    const s = this.stats;
    this.rotation += dt * 0.5;
    this.pulse += dt * 2.4;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.wallFlash > 0) this.wallFlash -= dt;
    if (this.rapidFireTimer > 0) this.rapidFireTimer -= dt;
    if (this.wallInvincibleTimer > 0) this.wallInvincibleTimer -= dt;

    if (s.hpRegen > 0 && this.hp < s.maxHp) {
      this.hp = Math.min(this.hp + s.hpRegen * dt, s.maxHp);
    }
    if (s.wallRegen > 0 && this.wallHp < this.maxWallHp) {
      this.wallHp = Math.min(this.wallHp + s.wallRegen * dt, this.maxWallHp);
    }

    this.orbAngle += s.orbSpeed * dt;

    // ---- 自動攻撃 ----
    this.attackCooldown -= dt;
    if (this.attackCooldown <= 0) {
      const fired = this.tryAttack();
      if (fired) {
        const rate = this.rapidFireTimer > 0 ? CONFIG.RAPID_FIRE_RATE : 1;
        this.attackCooldown = s.attackInterval * rate;
      } else {
        this.attackCooldown = 0;
      }
    }

    // ---- 地雷の自動設置 ----
    if (s.mineDamage > 0) {
      this.mineTimer -= dt;
      if (this.mineTimer <= 0) {
        this.mineTimer = CONFIG.MINE_INTERVAL;
        this.game.deployMine();
      }
    }

    // ---- ガーリック（近接DoT）: 0.25秒毎に適用して負荷を抑える ----
    if (s.garlicThorns > 0) {
      this.garlicTimer -= dt;
      if (this.garlicTimer <= 0) {
        this.garlicTimer = 0.25;
        this.game.applyGarlicDamage(s.garlicThorns * 0.25);
      }
    }
  }

  tryAttack() {
    const s = this.stats;
    const multishot = Math.random() < s.multishotChance;
    const k = multishot ? Math.min(s.multishotTargets, 7) : 1;
    const targets = this.findNearestTargets(k);
    if (targets.length === 0) return false;

    if (this.rapidFireTimer <= 0 && Math.random() < s.rapidFireChance) {
      this.rapidFireTimer = s.rapidFireDuration;
    }

    for (let i = 0; i < targets.length; i++) this.fireAt(targets[i]);
    this.game.sfx.laser();
    return true;
  }

  /** 射程内の近い順に最大k体（バッファ再利用で配列生成なし） */
  findNearestTargets(k) {
    const enemies = this.game.enemies;
    const cx = this.game.cx;
    const cy = this.game.cy;
    const rangeSq = this.stats.range * this.stats.range;
    const buf = this._targetBuf;
    const dist = this._targetDist;
    buf.length = 0;
    dist.length = 0;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - cx;
      const dy = e.y - cy;
      const dSq = dx * dx + dy * dy;
      if (dSq > rangeSq) continue;

      let pos = buf.length;
      for (let j = 0; j < buf.length; j++) {
        if (dSq < dist[j]) { pos = j; break; }
      }
      if (pos >= k) continue;
      const len = Math.min(buf.length + 1, k);
      for (let m = len - 1; m > pos; m--) {
        buf[m] = buf[m - 1];
        dist[m] = dist[m - 1];
      }
      buf[pos] = e;
      dist[pos] = dSq;
      buf.length = len;
      dist.length = len;
    }
    return buf;
  }

  fireAt(target) {
    const g = this.game;
    const s = this.stats;

    let critTier = 0;
    let dmg = s.damage;
    if (Math.random() < s.critChance) {
      critTier = 1;
      dmg *= s.critMultiplier;
      if (Math.random() < s.superCritChance) {
        critTier = 2;
        dmg *= s.superCritMultiplier;
      }
    }

    const bounces =
      Math.random() < s.bounceChance ? Math.min(s.bounceCount, 7) : 0;

    const p = g.projectilePool.acquire();
    p.init(g.cx, g.cy, target, dmg, critTier, bounces, s.bounceRange);
    g.projectiles.push(p);

    const angle = Math.atan2(target.y - g.cy, target.x - g.cx);
    g.spawnParticles(
      g.cx + Math.cos(angle) * CONFIG.CORE_RADIUS,
      g.cy + Math.sin(angle) * CONFIG.CORE_RADIUS,
      3, 90, 0.14, 2.2, '#8df3ff'
    );
  }

  /**
   * ダメージ処理。防御壁がある場合は壁が肩代わりする。
   * 壁は無敵時間中は一切ダメージを受けない。
   */
  takeDamage(amount, source) {
    const s = this.stats;
    if (Math.random() < s.enemyAttackSkip) return;

    // ---- 防御壁が優先で受ける ----
    if (this.maxWallHp > 0 && this.wallHp > 0) {
      if (this.wallInvincibleTimer > 0) return;
      this.wallHp -= amount;
      this.wallFlash = 0.2;
      this.wallInvincibleTimer = s.wallInvincible;
      this.game.shakeScreen(4);
      if (this.wallHp <= 0) {
        this.wallHp = 0;
        this.game.spawnShockwave(
          this.game.cx, this.game.cy, CONFIG.WALL_RADIUS + 30, '#00e5ff'
        );
        this.game.sfx.explosion();
      }
      // 反射ダメージ
      if (s.wallThorns > 0 && source) {
        this.game.damageEnemy(source, s.wallThorns, 0, false);
      }
      return;
    }

    const reduced = Math.max(amount - s.defense, 1);
    this.hp -= reduced;
    this.hurtFlash = 0.25;
    this.game.shakeScreen(7);
    if (this.hp <= 0) {
      this.hp = 0;
      this.game.gameOver();
    }
  }

  heal(amount) {
    this.hp = Math.min(this.hp + amount, this.stats.maxHp);
  }
}

/* =========================================================
 * 7. Wave管理
 * ======================================================= */

class WaveManager {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.totalToSpawn = 0;
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0;
    this.intermission = 0;
    this.state = 'intermission'; // 'warning' | 'spawning' | 'clearing' | 'intermission'
    this.warningTimer = 0;
    this.isBossWave = false;
  }

  startNextWave() {
    this.wave++;
    this.isBossWave = WAVE_RULES.isBossWave(this.wave);
    this.totalToSpawn = this.isBossWave
      ? Math.floor(WAVE_RULES.enemyCount(this.wave) * 0.5) + 1
      : WAVE_RULES.enemyCount(this.wave);
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0;

    if (this.isBossWave) {
      // ボスWaveは警告演出を挟んでから出現
      this.state = 'warning';
      this.warningTimer = CONFIG.BOSS_WARNING_TIME;
      this.game.onBossWarning();
    } else {
      this.state = 'spawning';
    }
    this.game.onWaveStart(this.wave);
  }

  update(dt) {
    const g = this.game;

    if (this.state === 'intermission') {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startNextWave();
      return;
    }

    if (this.state === 'warning') {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0) {
        this.state = 'spawning';
        this.game.onBossWarningEnd();
        this.spawnBoss();
        this.spawned++;
      }
      return;
    }

    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawned++;
        this.spawnTimer = WAVE_RULES.spawnInterval(this.wave);
        if (this.spawned >= this.totalToSpawn) this.state = 'clearing';
      }
    }

    if (this.state === 'clearing' && g.enemies.length === 0) {
      this.state = 'intermission';
      this.intermission = CONFIG.WAVE_INTERMISSION;
      g.onWaveClear(this.wave);
    }
  }

  /** 画面外の360°ランダム位置を返す */
  randomSpawnPoint(out) {
    const g = this.game;
    const angle = Math.random() * TAU;
    const radius = Math.hypot(g.width, g.height) * 0.5 + CONFIG.SPAWN_MARGIN;
    out.x = g.cx + Math.cos(angle) * radius;
    out.y = g.cy + Math.sin(angle) * radius;
    return out;
  }

  spawnEnemy() {
    const g = this.game;
    const type = this.pickEnemyType();
    const pt = this.randomSpawnPoint(g._spawnPt);

    const e = g.enemyPool.acquire();
    e.init(type, this.wave, pt.x, pt.y);
    if (Math.random() < g.player.stats.enemyHpSkip) e.hp *= 0.5;
    g.enemies.push(e);
    g.discoverEnemy(type.id);
  }

  spawnBoss() {
    const g = this.game;
    const type = ENEMY_TYPES.find((t) => t.boss);
    const pt = this.randomSpawnPoint(g._spawnPt);

    const e = g.enemyPool.acquire();
    e.init(type, this.wave, pt.x, pt.y);
    g.enemies.push(e);
    g.currentBoss = e;
    g.discoverEnemy(type.id);
    g.onBossAppear(e);
  }

  /** 重み付き抽選（boss はweight 0のため通常抽選には出ない） */
  pickEnemyType() {
    let totalWeight = 0;
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const t = ENEMY_TYPES[i];
      if (this.wave >= t.minWave && t.weight > 0) totalWeight += t.weight;
    }
    let r = Math.random() * totalWeight;
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const t = ENEMY_TYPES[i];
      if (this.wave < t.minWave || t.weight <= 0) continue;
      r -= t.weight;
      if (r <= 0) return t;
    }
    return ENEMY_TYPES[0];
  }

  get remaining() { return this.totalToSpawn - this.killed; }
  get progress() {
    return this.totalToSpawn > 0 ? this.killed / this.totalToSpawn : 0;
  }
}

/* =========================================================
 * 8. ショップ（UPGRADES配列から自動生成）
 * ======================================================= */

class Shop {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('shop-panel');
    this.listEl = document.getElementById('shop-list');
    this.cashEl = document.getElementById('val-shop-cash');
    this.activeCategory = SHOP_CATEGORIES[0].id;
    this.buyMultIndex = 0;
    this.isOpen = false;
    this.updateTimer = 0;
    this.itemEls = new Map();

    this.bindEvents();
    this.buildList();
  }

  get buyMult() { return BUY_MULTIPLIERS[this.buyMultIndex]; }

  bindEvents() {
    document.getElementById('btn-shop')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-shop-close')
      .addEventListener('click', () => this.close());

    const tabs = document.querySelectorAll('.shop-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = tab.dataset.category;
        this.buildList();
      });
    });

    document.getElementById('btn-buy-mult')
      .addEventListener('click', () => {
        this.buyMultIndex = (this.buyMultIndex + 1) % BUY_MULTIPLIERS.length;
        const label = this.buyMult === 'MAX' ? 'MAX' : '×' + this.buyMult;
        document.getElementById('val-buy-mult').textContent = label;
        this.game.sfx.unlock();
        this.refresh(true);
      });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.codex.close();
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.refresh(true);
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  buildList() {
    this.listEl.textContent = '';
    this.itemEls.clear();

    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      if (u.category !== this.activeCategory) continue;

      const root = document.createElement('div');
      root.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-item-info';

      const top = document.createElement('div');
      top.className = 'shop-item-top';
      const name = document.createElement('span');
      name.className = 'shop-item-name';
      name.textContent = u.name;
      const level = document.createElement('span');
      level.className = 'shop-item-level';
      top.appendChild(name);
      top.appendChild(level);

      const desc = document.createElement('div');
      desc.className = 'shop-item-desc';
      desc.textContent = u.description;

      const value = document.createElement('div');
      value.className = 'shop-item-value';

      info.appendChild(top);
      info.appendChild(desc);
      info.appendChild(value);

      const btn = document.createElement('button');
      btn.className = 'shop-buy-btn';
      const count = document.createElement('span');
      count.className = 'buy-count';
      const cost = document.createElement('span');
      cost.className = 'buy-cost';
      btn.appendChild(count);
      btn.appendChild(cost);
      btn.addEventListener('click', () => this.buy(u));

      root.appendChild(info);
      root.appendChild(btn);
      this.listEl.appendChild(root);

      this.itemEls.set(u.id, { root, level, value, btn, count, cost });
    }
    this.refresh(true);
  }

  refresh(force) {
    if (!this.isOpen && !force) return;
    const cash = this.game.cash;
    this.cashEl.textContent = formatNumber(cash);

    this.itemEls.forEach((els, id) => {
      const u = UPGRADES.find((x) => x.id === id);
      const maxed = u.level >= u.maxLevel;
      els.level.textContent = 'Lv ' + u.level + '/' + u.maxLevel;

      const plan = calcBuyPlan(u, cash, this.buyMult);
      const nextLevel = Math.min(u.level + Math.max(plan.count, 1), u.maxLevel);

      if (maxed) {
        els.value.textContent = u.valueText(u.level);
      } else {
        els.value.textContent = '';
        els.value.appendChild(
          document.createTextNode(u.valueText(u.level) + ' → ')
        );
        const next = document.createElement('span');
        next.className = 'next';
        next.textContent = u.valueText(nextLevel);
        els.value.appendChild(next);
      }

      if (maxed) {
        els.btn.classList.add('maxed');
        els.btn.classList.remove('disabled');
        els.count.textContent = 'MAX';
        els.cost.textContent = '─';
      } else {
        els.btn.classList.remove('maxed');
        const affordable = plan.count > 0;
        els.btn.classList.toggle('disabled', !affordable);
        els.count.textContent = affordable
          ? '×' + plan.count
          : this.buyMult === 'MAX'
            ? 'MAX'
            : '×' + Math.min(this.buyMult, u.maxLevel - u.level);
        els.cost.textContent = '$' + formatNumber(plan.cost);
      }
    });
  }

  buy(u) {
    const g = this.game;
    g.sfx.unlock();

    const els = this.itemEls.get(u.id);
    if (u.level >= u.maxLevel) return;

    const plan = calcBuyPlan(u, g.cash, this.buyMult);
    if (plan.count <= 0) {
      g.sfx.deny();
      if (els) {
        els.btn.classList.remove('deny');
        void els.btn.offsetWidth;
        els.btn.classList.add('deny');
      }
      return;
    }

    g.spendCash(plan.cost);
    u.level += plan.count;
    g.player.recalc();

    g.sfx.buy();
    if (els) {
      els.btn.classList.remove('glow');
      els.level.classList.remove('pop');
      void els.btn.offsetWidth;
      els.btn.classList.add('glow');
      els.level.classList.add('pop');
    }
    this.refresh(true);
    g.hudDirty = true;
  }

  update(dt) {
    if (!this.isOpen) return;
    this.updateTimer += dt;
    if (this.updateTimer >= CONFIG.SHOP_UPDATE_INTERVAL) {
      this.updateTimer = 0;
      this.refresh();
    }
  }
}

/* =========================================================
 * 9. 図鑑（ENEMY_TYPES配列から自動生成）
 * ======================================================= */

class Codex {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('codex-panel');
    this.listEl = document.getElementById('codex-list');
    this.isOpen = false;

    document.getElementById('btn-codex')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-codex-close')
      .addEventListener('click', () => this.close());
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.shop.close();
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.build();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  build() {
    const g = this.game;
    this.listEl.textContent = '';

    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const t = ENEMY_TYPES[i];
      const found = g.discovered.has(t.id);
      const kills = g.killsByType[t.id] || 0;

      const root = document.createElement('div');
      root.className = 'codex-item' + (found ? '' : ' undiscovered');

      const icon = document.createElement('div');
      icon.className = 'codex-icon';
      icon.style.background = found ? t.color : '#1a2536';
      icon.style.boxShadow = found ? '0 0 12px ' + t.glow : 'none';
      if (t.shape === 'square') icon.style.borderRadius = '4px';
      else if (t.shape === 'triangle') icon.style.clipPath =
        'polygon(50% 0%, 100% 100%, 0% 100%)';

      const info = document.createElement('div');
      info.className = 'codex-info';

      const name = document.createElement('div');
      name.className = 'codex-name';
      name.textContent = found ? t.name : '???';
      name.style.color = found ? t.color : 'var(--text-dim)';

      const desc = document.createElement('div');
      desc.className = 'codex-desc';
      desc.textContent = found ? t.desc : '未確認の個体';

      info.appendChild(name);
      info.appendChild(desc);

      if (found) {
        const stats = document.createElement('div');
        stats.className = 'codex-stats';
        stats.textContent =
          'HP ' + t.baseHp + ' / ATK ' + t.baseAtk +
          ' / SPD ' + t.baseSpeed + ' / W' + t.minWave + '～';
        info.appendChild(stats);
      }

      const killEl = document.createElement('div');
      killEl.className = 'codex-kills';
      killEl.textContent = found ? formatNumber(kills) + '体' : '─';

      root.appendChild(icon);
      root.appendChild(info);
      root.appendChild(killEl);
      this.listEl.appendChild(root);
    }
  }
}

/* =========================================================
 * 10. ゲーム本体
 * ======================================================= */

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');

    this.width = 0; this.height = 0;
    this.cx = 0; this.cy = 0;
    this.dpr = 1;

    // エンティティ配列
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.particles = [];
    this.damageNumbers = [];
    this.mines = [];
    this.shockwaves = [];
    this.packages = [];

    // プール
    this.enemyPool = new Pool(() => new Enemy(), 80);
    this.projectilePool = new Pool(() => new Projectile(), 80);
    this.enemyProjectilePool = new Pool(() => new EnemyProjectile(), 40);
    this.particlePool = new Pool(() => new Particle(), 400);
    this.damageNumberPool = new Pool(() => new DamageNumber(), 80);
    this.minePool = new Pool(() => new Mine(), 16);
    this.shockwavePool = new Pool(() => new Shockwave(), 24);
    this.packagePool = new Pool(() => new Package(), 16);

    // 通貨・記録
    this.cash = 0;
    this.coin = 0;
    this.coinFrac = 0;
    this.gem = 0;
    this.totalKills = 0;
    this.killsByType = Object.create(null);
    this.discovered = new Set();

    this.dpsAccum = 0;
    this.dpsTimer = 0;
    this.dps = 0;

    // 演出状態
    this.shake = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.currentBoss = null;

    // 一時オブジェクト（毎フレームの生成を避ける）
    this._spawnPt = { x: 0, y: 0 };

    this.sfx = new Sfx();
    this.player = new Player(this);
    this.waveManager = new WaveManager(this);

    this.running = false;
    this.lastTime = 0;
    this.hudTimer = 0;
    this.hudDirty = false;
    this.fpsFrames = 0;
    this.fpsTimer = 0;
    this.toastTimer = null;

    this.hud = this.cacheHudElements();
    this.shop = new Shop(this);
    this.codex = new Codex(this);
    this.bindEvents();
    this.resize();
    this.renderFrame();

    this._loop = this.loop.bind(this);
  }

  cacheHudElements() {
    const $ = (id) => document.getElementById(id);
    return {
      cash: $('val-cash'),
      cashItem: document.querySelector('.currency-cash'),
      coin: $('val-coin'),
      gem: $('val-gem'),
      waveBox: $('hud-wave'),
      wave: $('val-wave'),
      remaining: $('val-remaining'),
      waveBarFill: $('wave-bar-fill'),
      bossBar: $('boss-bar'),
      bossHpFill: $('boss-hp-fill'),
      bossHpText: $('boss-hp-text'),
      bossWarning: $('boss-warning'),
      hp: $('val-hp'),
      hpMax: $('val-hp-max'),
      hpBarFill: $('hp-bar-fill'),
      wallBar: $('wall-bar'),
      wallBarFill: $('wall-bar-fill'),
      atk: $('val-atk'),
      aspd: $('val-aspd'),
      dps: $('val-dps'),
      fps: $('fps'),
      toast: $('toast'),
      soundBtn: $('btn-sound'),
      soundIcon: $('sound-icon'),
      overlayStart: $('overlay-start'),
      overlayGameOver: $('overlay-gameover'),
      goWave: $('go-wave'),
      goKills: $('go-kills'),
      goCoin: $('go-coin'),
    };
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    document.getElementById('btn-start')
      .addEventListener('click', () => { this.sfx.unlock(); this.start(); });
    document.getElementById('btn-restart')
      .addEventListener('click', () => { this.sfx.unlock(); this.restart(); });

    this.hud.soundBtn.addEventListener('click', () => {
      this.sfx.unlock();
      const on = !this.sfx.enabled;
      this.sfx.setEnabled(on);
      this.hud.soundIcon.textContent = on ? '♪' : '✕';
      this.hud.soundBtn.classList.toggle('muted', !on);
    });

    document.querySelectorAll('.menu-btn-locked').forEach((btn) => {
      btn.addEventListener('click', () => this.showToast(btn.dataset.locked));
    });

    // タブ非アクティブ時はBGMを止めて負荷を下げる
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.sfx.stopBgm();
      else if (this.running) this.sfx.startBgm();
    });
  }

  /* ---------- 通貨 ---------- */

  addCash(amount) { this.cash += amount; }

  spendCash(amount) {
    this.cash -= amount;
    const el = this.hud.cashItem;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  addCoin(amount) {
    this.coinFrac += amount;
    if (this.coinFrac >= 1) {
      const whole = Math.floor(this.coinFrac);
      this.coin += whole;
      this.coinFrac -= whole;
    }
  }

  /* ---------- 画面サイズ・背景 ---------- */

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_MAX);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.cx = this.width / 2;
    this.cy = this.height / 2;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.renderBackground();
  }

  renderBackground() {
    const c = this.bgCanvas;
    const g = this.bgCtx;
    c.width = this.width * this.dpr;
    c.height = this.height * this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const grad = g.createRadialGradient(
      this.cx, this.cy, 0,
      this.cx, this.cy, Math.max(this.width, this.height) * 0.75
    );
    grad.addColorStop(0, '#0a1220');
    grad.addColorStop(1, '#04060c');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.width, this.height);

    const step = 48;
    g.strokeStyle = 'rgba(0, 229, 255, 0.05)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = this.cx % step; x < this.width; x += step) {
      g.moveTo(x, 0); g.lineTo(x, this.height);
    }
    for (let y = this.cy % step; y < this.height; y += step) {
      g.moveTo(0, y); g.lineTo(this.width, y);
    }
    g.stroke();

    g.strokeStyle = 'rgba(0, 229, 255, 0.06)';
    g.beginPath();
    for (let r = 90; r < Math.max(this.width, this.height); r += 90) {
      g.moveTo(this.cx + r, this.cy);
      g.arc(this.cx, this.cy, r, 0, TAU);
    }
    g.stroke();
  }

  /* ---------- 演出ヘルパー ---------- */

  shakeScreen(amount) {
    this.shake = Math.min(this.shake + amount, CONFIG.SHAKE_MAX);
  }

  /** ヒットストップ（クリティカル等で一瞬時間を止める） */
  applyHitstop(duration) {
    if (duration > this.hitstop) this.hitstop = duration;
  }

  flashScreen(duration, color) {
    this.flash = duration;
    this.flashColor = color;
  }

  /* ---------- ゲーム進行 ---------- */

  start() {
    this.hud.overlayStart.classList.add('hidden');
    this.running = true;
    this.lastTime = performance.now();
    this.waveManager.startNextWave();
    this.sfx.startBgm();
    requestAnimationFrame(this._loop);
  }

  restart() {
    this.releaseAll(this.enemies, this.enemyPool);
    this.releaseAll(this.projectiles, this.projectilePool);
    this.releaseAll(this.enemyProjectiles, this.enemyProjectilePool);
    this.releaseAll(this.particles, this.particlePool);
    this.releaseAll(this.damageNumbers, this.damageNumberPool);
    this.releaseAll(this.mines, this.minePool);
    this.releaseAll(this.shockwaves, this.shockwavePool);
    this.releaseAll(this.packages, this.packagePool);

    this.cash = 0;
    this.totalKills = 0;
    this.dps = 0;
    this.dpsAccum = 0;
    this.shake = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.currentBoss = null;
    this.hud.bossBar.classList.add('hidden');
    this.hud.waveBox.classList.remove('boss-wave');

    // 戦闘中アップグレードはリセット（Coinは永続研究用に持ち越し）
    for (let i = 0; i < UPGRADES.length; i++) UPGRADES[i].level = 0;

    this.player = new Player(this);
    this.waveManager = new WaveManager(this);
    this.shop.refresh(true);

    this.hud.overlayGameOver.classList.add('hidden');
    this.running = true;
    this.lastTime = performance.now();
    this.waveManager.startNextWave();
    this.sfx.setBgmIntensity(false);
    this.sfx.startBgm();
    requestAnimationFrame(this._loop);
  }

  releaseAll(arr, pool) {
    for (let i = 0; i < arr.length; i++) pool.release(arr[i]);
    arr.length = 0;
  }

  gameOver() {
    this.running = false;
    this.shop.close();
    this.codex.close();
    this.sfx.gameOver();
    this.flashScreen(0.4, '#ff3b5c');
    this.shakeScreen(CONFIG.SHAKE_MAX);

    const earned = Math.floor(
      this.waveManager.wave * 1.5 + this.totalKills * 0.1
    );
    this.coin += earned;
    this.hud.goWave.textContent = this.waveManager.wave;
    this.hud.goKills.textContent = formatNumber(this.totalKills);
    this.hud.goCoin.textContent = formatNumber(earned);
    this.hud.overlayGameOver.classList.remove('hidden');
  }

  onWaveStart(wave) {
    this.hud.waveBox.classList.toggle(
      'boss-wave', WAVE_RULES.isBossWave(wave)
    );
  }

  onBossWarning() {
    this.hud.bossWarning.classList.remove('hidden');
    this.sfx.bossAppear();
    this.sfx.setBgmIntensity(true);
    this.shakeScreen(6);
  }

  onBossWarningEnd() {
    this.hud.bossWarning.classList.add('hidden');
  }

  onBossAppear(boss) {
    this.hud.bossBar.classList.remove('hidden');
    this.flashScreen(0.25, '#ff2d95');
    this.shakeScreen(10);
    this.spawnShockwave(boss.x, boss.y, 140, '#ff2d95');
  }

  onBossDefeat(boss) {
    this.sfx.bossDefeat();
    this.flashScreen(0.35, '#ff2d95');
    this.shakeScreen(CONFIG.SHAKE_MAX);
    this.applyHitstop(0.12);
    this.spawnShockwave(boss.x, boss.y, 220, '#ff2d95');
    this.spawnParticles(boss.x, boss.y, 40, 320, 0.8, 5, boss.type.color);

    // Boss Package: ボス撃破時の補給
    const n = this.player.stats.bossPackage;
    for (let i = 0; i < n; i++) this.spawnPackage(boss.x, boss.y, boss.cash * 0.2);

    this.currentBoss = null;
    this.hud.bossBar.classList.add('hidden');
    this.sfx.setBgmIntensity(false);
  }

  onWaveClear(wave) {
    const s = this.player.stats;
    let bonusCash = 0;

    if (s.cashPerWave > 0) bonusCash += s.cashPerWave * WAVE_RULES.cashMul(wave);
    if (s.interest > 0) {
      bonusCash += Math.min(Math.floor(this.cash * s.interest), s.maxInterestCap);
    }
    if (bonusCash > 0) this.addCash(Math.floor(bonusCash));
    if (s.coinPerWave > 0) this.addCoin(s.coinPerWave);

    this.sfx.waveClear();
  }

  /* ---------- メインループ ---------- */

  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > CONFIG.MAX_DT) dt = CONFIG.MAX_DT;

    // 演出タイマーは実時間で減衰させる
    const realDt = dt;
    if (this.shake > 0) this.shake = Math.max(this.shake - realDt * 42, 0);
    if (this.flash > 0) this.flash -= realDt;

    // ヒットストップ中はゲーム内時間を大幅に遅くする
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      dt *= CONFIG.HITSTOP_SCALE;
    }

    this.update(dt);
    this.renderFrame();
    this.updateHud(realDt);
    this.updateFps(realDt);

    requestAnimationFrame(this._loop);
  }

  update(dt) {
    this.waveManager.update(dt);
    this.player.update(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(dt);
    this.updateOrbs(dt);
    this.updateMines(dt);
    this.updateShockwaves(dt);
    this.updatePackages(dt);
    this.updateParticles(dt);
    this.updateDamageNumbers(dt);
    this.shop.update(dt);

    this.dpsTimer += dt;
    if (this.dpsTimer >= 1) {
      this.dps = this.dpsAccum / this.dpsTimer;
      this.dpsAccum = 0;
      this.dpsTimer = 0;
    }
  }

  /* ---------- 敵 ---------- */

  updateEnemies(dt) {
    const wallActive = this.player.maxWallHp > 0 && this.player.wallHp > 0;
    const barrier = wallActive ? CONFIG.WALL_RADIUS : CONFIG.CORE_RADIUS;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dist = e.update(dt, this);

      // 壁またはコアへの接触
      if (dist <= barrier + e.size) {
        this.player.takeDamage(e.atk, e);
        this.spawnParticles(e.x, e.y, 8, 140, 0.3, 3, e.type.color);
        this.sfx.explosion();

        if (e.isBoss) {
          // ボスは接触しても消滅せず、ノックバックして戦闘継続
          const ang = Math.atan2(e.y - this.cy, e.x - this.cx);
          e.x = this.cx + Math.cos(ang) * (barrier + e.size + 40);
          e.y = this.cy + Math.sin(ang) * (barrier + e.size + 40);
        } else {
          this.waveManager.killed++;
          this.enemyPool.release(swapRemove(this.enemies, i));
        }
      }
    }
  }

  spawnEnemyProjectile(enemy) {
    const p = this.enemyProjectilePool.acquire();
    p.init(enemy.x, enemy.y, this.cx, this.cy, enemy.atk, enemy.type.color);
    this.enemyProjectiles.push(p);
    this.spawnParticles(enemy.x, enemy.y, 3, 70, 0.16, 2, enemy.type.color);
  }

  updateEnemyProjectiles(dt) {
    const wallActive = this.player.maxWallHp > 0 && this.player.wallHp > 0;
    const barrier = wallActive ? CONFIG.WALL_RADIUS : CONFIG.CORE_RADIUS;

    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const p = this.enemyProjectiles[i];
      p.update(dt);

      const dx = p.x - this.cx;
      const dy = p.y - this.cy;
      let dead = p.life <= 0;

      if (!dead && dx * dx + dy * dy <= barrier * barrier) {
        this.player.takeDamage(p.damage, null);
        this.spawnParticles(p.x, p.y, 6, 120, 0.25, 2.6, p.color);
        this.sfx.hit();
        dead = true;
      }

      if (dead) {
        this.enemyProjectilePool.release(swapRemove(this.enemyProjectiles, i));
      }
    }
  }

  /* ---------- 自弾 ---------- */

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);

      let dead = p.life <= 0;

      if (!dead) {
        const t = p.target;
        let hitTarget = null;
        if (t && t.hp > 0) {
          const dx = t.x - p.x;
          const dy = t.y - p.y;
          if (dx * dx + dy * dy <= (t.size + 4) * (t.size + 4)) hitTarget = t;
        } else {
          hitTarget = this.findProjectileHit(p);
        }

        if (hitTarget) {
          const survived = this.onProjectileHit(hitTarget, p);
          dead = !survived;
        }
      }

      if (dead) this.projectilePool.release(swapRemove(this.projectiles, i));
    }
  }

  findProjectileHit(p) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy <= (e.size + 4) * (e.size + 4)) return e;
    }
    return null;
  }

  /** 弾のヒット処理。跳弾で弾が継続する場合 true */
  onProjectileHit(enemy, projectile) {
    const s = this.player.stats;

    let dmg = projectile.damage;
    if (s.damagePerMeter > 0) {
      const dx = enemy.x - this.cx;
      const dy = enemy.y - this.cy;
      dmg *= 1 + s.damagePerMeter * (Math.hypot(dx, dy) / 100);
    }

    if (s.armorBreakChance > 0 && Math.random() < s.armorBreakChance) {
      enemy.dmgTakenMul = s.armorBreakMultiplier;
      enemy.armorBreakTimer = CONFIG.ARMOR_BREAK_DURATION;
    }

    this.damageEnemy(enemy, dmg, projectile.critTier, true);

    // ---- クリティカル演出 ----
    if (projectile.critTier === 2) {
      this.flashScreen(0.16, '#ff2d95');
      this.shakeScreen(9);
      this.applyHitstop(0.07);
      this.sfx.crit();
      this.spawnParticles(projectile.x, projectile.y, 14, 260, 0.45, 3.4, '#ff2d95');
    } else if (projectile.critTier === 1) {
      this.shakeScreen(2.5);
      this.applyHitstop(0.025);
      this.sfx.crit();
      this.spawnParticles(projectile.x, projectile.y, 6, 160, 0.28, 2.8, '#ffc233');
    } else {
      this.spawnParticles(projectile.x, projectile.y, 4, 120, 0.2, 2.4, '#8df3ff');
      this.sfx.hit();
    }

    // ---- 跳弾 ----
    if (projectile.bouncesLeft > 0) {
      const next = this.findBounceTarget(projectile, enemy);
      if (next) {
        projectile.bouncesLeft--;
        projectile.target = next;
        projectile.life = CONFIG.PROJECTILE_LIFE;
        projectile.aimAt(next.x, next.y);
        return true;
      }
    }
    return false;
  }

  findBounceTarget(projectile, exclude) {
    const rSq = projectile.bounceRange * projectile.bounceRange;
    let best = null;
    let bestSq = Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e === exclude || e.hp <= 0) continue;
      const dx = e.x - projectile.x;
      const dy = e.y - projectile.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= rSq && dSq < bestSq) { bestSq = dSq; best = e; }
    }
    return best;
  }

  /**
   * 敵へのダメージ適用（全ダメージ源の共通経路）。
   * showNumber=false のDoT等はダメージ数字を出さず描画負荷を抑える。
   */
  damageEnemy(enemy, amount, critTier, showNumber) {
    const dmg = amount * enemy.dmgTakenMul;
    enemy.hp -= dmg;
    enemy.hitFlash = 0.08;
    this.dpsAccum += dmg;

    if (showNumber) {
      const d = this.damageNumberPool.acquire();
      d.init(enemy.x, enemy.y - enemy.size, dmg, critTier || 0);
      this.damageNumbers.push(d);
    }

    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;

    const s = this.player.stats;
    this.addCash(Math.ceil(enemy.cash * s.cashBonus));
    if (enemy.coin > 0) this.addCoin(enemy.coin);
    if (s.coinPerKill > 0) this.addCoin(s.coinPerKill);
    this.totalKills++;
    this.waveManager.killed++;

    const tid = enemy.type.id;
    this.killsByType[tid] = (this.killsByType[tid] || 0) + 1;

    if (enemy.isBoss) {
      this.onBossDefeat(enemy);
    } else {
      this.spawnParticles(enemy.x, enemy.y, 10, 170, 0.35, 3, enemy.type.color);
      // パッケージドロップ
      if (s.packageChance > 0 && Math.random() < s.packageChance) {
        this.spawnPackage(enemy.x, enemy.y, enemy.cash * 2);
      }
    }

    this.enemyPool.release(swapRemove(this.enemies, idx));
  }

  discoverEnemy(id) {
    if (!this.discovered.has(id)) {
      this.discovered.add(id);
      const t = ENEMY_TYPES.find((x) => x.id === id);
      if (t && !t.boss) this.showToast('新種を確認: ' + t.name);
    }
  }

  /* ---------- 特殊攻撃: オーブ ---------- */

  /**
   * オーブはエンティティを持たず、角度から座標を都度算出する。
   * 生成コストゼロで最大8基まで扱える。
   */
  updateOrbs(dt) {
    const s = this.player.stats;
    const n = s.orbCount;
    if (n <= 0 || s.orbDamage <= 0) return;

    const baseAngle = this.player.orbAngle;
    const dmg = s.orbDamage * dt * 4; // 接触中は継続ダメージ

    for (let o = 0; o < n; o++) {
      const a = baseAngle + (o / n) * TAU;
      const ox = this.cx + Math.cos(a) * CONFIG.ORB_RADIUS;
      const oy = this.cy + Math.sin(a) * CONFIG.ORB_RADIUS;

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        const dx = e.x - ox;
        const dy = e.y - oy;
        const r = e.size + CONFIG.ORB_SIZE;
        if (dx * dx + dy * dy > r * r) continue;

        let total = dmg;
        // Orb Boss Damage: ボスへは最大HP割合ダメージを追加
        if (e.isBoss && s.orbBossDamage > 0) {
          total += e.maxHp * s.orbBossDamage * dt * 4;
        }
        this.damageEnemy(e, total, 0, false);
        if (Math.random() < 0.15) {
          this.spawnParticles(ox, oy, 2, 90, 0.18, 2, '#00e5ff');
        }
      }
    }
  }

  /* ---------- 特殊攻撃: 地雷 ---------- */

  deployMine() {
    if (this.mines.length >= CONFIG.MINE_MAX) return;
    const s = this.player.stats;
    // コア周辺のランダム位置へ設置
    const a = Math.random() * TAU;
    const r = 60 + Math.random() * (s.range * 0.9);
    const m = this.minePool.acquire();
    m.init(
      this.cx + Math.cos(a) * r,
      this.cy + Math.sin(a) * r,
      s.mineDecay,
      s.mineDamage,
      s.shockwaveSize
    );
    this.mines.push(m);
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.update(dt);

      let detonate = m.timer <= 0;

      // 敵接触でも起爆
      if (!detonate) {
        for (let j = 0; j < this.enemies.length; j++) {
          const e = this.enemies[j];
          const dx = e.x - m.x;
          const dy = e.y - m.y;
          const r = e.size + 8;
          if (dx * dx + dy * dy <= r * r) { detonate = true; break; }
        }
      }

      if (detonate) {
        this.explode(m.x, m.y, m.radius, m.damage, '#ffc233');
        this.minePool.release(swapRemove(this.mines, i));
      }
    }
  }

  /** 範囲爆発（地雷・将来のミサイル等から共通で呼べる） */
  explode(x, y, radius, damage, color) {
    this.spawnShockwave(x, y, radius, color);
    this.spawnParticles(x, y, 12, 220, 0.4, 3.2, color);
    this.sfx.explosion();
    this.shakeScreen(3);

    const rSq = radius * radius;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= rSq) this.damageEnemy(e, damage, 0, true);
    }
  }

  spawnShockwave(x, y, radius, color) {
    const w = this.shockwavePool.acquire();
    w.init(x, y, radius, color);
    this.shockwaves.push(w);
  }

  updateShockwaves(dt) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i];
      w.update(dt);
      if (w.life <= 0) {
        this.shockwavePool.release(swapRemove(this.shockwaves, i));
      }
    }
  }

  /* ---------- 特殊攻撃: ガーリック（近接DoT） ---------- */

  applyGarlicDamage(amount) {
    const rSq = CONFIG.GARLIC_RADIUS * CONFIG.GARLIC_RADIUS;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.x - this.cx;
      const dy = e.y - this.cy;
      if (dx * dx + dy * dy <= rSq) this.damageEnemy(e, amount, 0, false);
    }
  }

  /* ---------- 補給パッケージ ---------- */

  spawnPackage(x, y, cash) {
    if (this.packages.length >= this.player.stats.packageMax) return;
    const p = this.packagePool.acquire();
    p.init(x, y, Math.ceil(cash));
    this.packages.push(p);
  }

  updatePackages(dt) {
    for (let i = this.packages.length - 1; i >= 0; i--) {
      const p = this.packages[i];
      p.update(dt);
      if (p.life <= 0) {
        this.collectPackage(p);
        this.packagePool.release(swapRemove(this.packages, i));
      }
    }
  }

  collectPackage(p) {
    const s = this.player.stats;
    this.player.heal(s.maxHp * s.packageHeal);
    this.addCash(p.cash);
    this.spawnParticles(p.x, p.y, 10, 130, 0.4, 2.6, '#3dff9e');
    this.sfx.package_();
  }

  /* ---------- パーティクル・数字 ---------- */

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) this.particlePool.release(swapRemove(this.particles, i));
    }
  }

  updateDamageNumbers(dt) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.update(dt);
      if (d.life <= 0) {
        this.damageNumberPool.release(swapRemove(this.damageNumbers, i));
      }
    }
  }

  spawnParticles(x, y, count, speed, life, size, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.6);
      const p = this.particlePool.acquire();
      p.init(
        x, y,
        Math.cos(angle) * v, Math.sin(angle) * v,
        life * (0.7 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        color
      );
      this.particles.push(p);
    }
  }

  /* ---------- 描画 ---------- */

  renderFrame() {
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgCanvas, 0, 0);

    // 画面揺れ（背景以外を一括オフセット）
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, sx * this.dpr, sy * this.dpr);

    this.drawRange(ctx);
    this.drawGarlicField(ctx);
    this.drawMines(ctx);
    this.drawEnemies(ctx);
    this.drawEnemyProjectiles(ctx);
    this.drawProjectiles(ctx);
    this.drawShockwaves(ctx);
    this.drawPackages(ctx);
    this.drawParticles(ctx);
    this.drawWall(ctx);
    this.drawOrbs(ctx);
    this.drawCore(ctx);
    this.drawDamageNumbers(ctx);

    // 画面フラッシュ
    if (this.flash > 0) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = Math.min(this.flash * 1.6, 0.55);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
  }

  drawRange(ctx) {
    const r = this.player.stats.range;
    const pulse = 0.5 + Math.sin(this.player.pulse) * 0.15;
    ctx.strokeStyle = `rgba(0, 229, 255, ${0.18 * pulse + 0.08})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawGarlicField(ctx) {
    if (this.player.stats.garlicThorns <= 0) return;
    const pulse = 0.5 + Math.sin(this.player.pulse * 1.6) * 0.5;
    const grad = ctx.createRadialGradient(
      this.cx, this.cy, CONFIG.GARLIC_RADIUS * 0.3,
      this.cx, this.cy, CONFIG.GARLIC_RADIUS
    );
    grad.addColorStop(0, 'rgba(61, 255, 158, 0)');
    grad.addColorStop(1, `rgba(61, 255, 158, ${0.08 + pulse * 0.06})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, CONFIG.GARLIC_RADIUS, 0, TAU);
    ctx.fill();
  }

  drawWall(ctx) {
    const p = this.player;
    if (p.maxWallHp <= 0 || p.wallHp <= 0) return;

    const ratio = p.wallHp / p.maxWallHp;
    const invincible = p.wallInvincibleTimer > 0;
    const flash = p.wallFlash > 0 ? p.wallFlash / 0.2 : 0;

    ctx.save();
    ctx.strokeStyle = flash > 0
      ? `rgba(255, 255, 255, ${0.5 + flash * 0.5})`
      : `rgba(0, 229, 255, ${0.35 + ratio * 0.4})`;
    ctx.lineWidth = 2 + ratio * 2.5;
    ctx.shadowColor = invincible ? '#a561ff' : '#00e5ff';
    ctx.shadowBlur = invincible ? 18 : 10;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, CONFIG.WALL_RADIUS, 0, TAU);
    ctx.stroke();

    // 残量を示す弧
    ctx.strokeStyle = 'rgba(165, 97, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      this.cx, this.cy, CONFIG.WALL_RADIUS,
      -Math.PI / 2, -Math.PI / 2 + TAU * ratio
    );
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  drawOrbs(ctx) {
    const s = this.player.stats;
    const n = s.orbCount;
    if (n <= 0) return;

    const base = this.player.orbAngle;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 14;
    for (let o = 0; o < n; o++) {
      const a = base + (o / n) * TAU;
      const ox = this.cx + Math.cos(a) * CONFIG.ORB_RADIUS;
      const oy = this.cy + Math.sin(a) * CONFIG.ORB_RADIUS;
      ctx.beginPath();
      ctx.arc(ox, oy, CONFIG.ORB_SIZE, 0, TAU);
      ctx.fillStyle = '#7df0ff';
      ctx.fill();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  drawMines(ctx) {
    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i];
      const blink = 0.5 + Math.sin(m.pulse) * 0.5;
      ctx.shadowColor = '#ffc233';
      ctx.shadowBlur = 6 + blink * 8;
      ctx.fillStyle = `rgba(255, 194, 51, ${0.5 + blink * 0.5})`;
      tracePolygon(ctx, m.x, m.y, 6, 3, m.pulse * 0.3);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  drawShockwaves(ctx) {
    for (let i = 0; i < this.shockwaves.length; i++) {
      const w = this.shockwaves[i];
      const alpha = w.life / w.maxLife;
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 2 + alpha * 3;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawPackages(ctx) {
    for (let i = 0; i < this.packages.length; i++) {
      const p = this.packages[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.shadowColor = '#3dff9e';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(61, 255, 158, 0.25)';
      ctx.strokeStyle = '#3dff9e';
      ctx.lineWidth = 2;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  drawEnemies(ctx) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const wob = Math.sin(e.wobble) * 1.5;
      const y = e.y + wob;
      // 出現時のスケールアニメーション
      const scale = e.spawnAnim > 0 ? 1 + e.spawnAnim * 1.2 : 1;
      const size = e.size * scale;

      ctx.shadowColor = e.type.glow;
      ctx.shadowBlur = e.isBoss ? 24 : 10;
      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.type.color;

      switch (e.type.shape) {
        case 'triangle': tracePolygon(ctx, e.x, y, size, 3, e.rotation); break;
        case 'square':   tracePolygon(ctx, e.x, y, size, 4, e.rotation); break;
        case 'hex':      tracePolygon(ctx, e.x, y, size, 6, e.rotation); break;
        default:
          ctx.beginPath();
          ctx.arc(e.x, y, size, 0, TAU);
      }
      ctx.fill();

      // ボスは二重リングで威圧感を出す
      if (e.isBoss) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 45, 149, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 10 + Math.sin(e.wobble) * 3, 0, TAU);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // アーマーブレイク表示
      if (e.armorBreakTimer > 0) {
        ctx.strokeStyle = 'rgba(255, 194, 51, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(e.x, y, size + 3, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // HPバー（ボスは画面上部のバーで表示するため省略）
      if (!e.isBoss && e.hp < e.maxHp) {
        const w = e.size * 2;
        const ratio = Math.max(e.hp / e.maxHp, 0);
        const bx = e.x - e.size;
        const by = y - e.size - 7;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, by, w, 3);
        ctx.fillStyle = ratio > 0.4 ? '#3dff9e' : '#ff3b5c';
        ctx.fillRect(bx, by, w * ratio, 3);
      }
    }
  }

  drawEnemyProjectiles(ctx) {
    for (let i = 0; i < this.enemyProjectiles.length; i++) {
      const p = this.enemyProjectiles[i];
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  drawProjectiles(ctx) {
    ctx.lineCap = 'round';
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const tier = p.critTier;
      ctx.strokeStyle = tier === 2 ? '#ff2d95' : tier === 1 ? '#ffc233' : '#5cf0ff';
      ctx.lineWidth = tier === 2 ? 5 : tier === 1 ? 4 : 2.5;
      ctx.shadowColor = tier === 2 ? '#ff2d95' : tier === 1 ? '#ffc233' : '#00e5ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  drawParticles(ctx) {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawCore(ctx) {
    const { cx, cy } = this;
    const p = this.player;
    const r = CONFIG.CORE_RADIUS;
    const glow = 0.6 + Math.sin(p.pulse) * 0.25;
    const hurt = p.hurtFlash > 0 ? p.hurtFlash / 0.25 : 0;
    const rapid = p.rapidFireTimer > 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.rotation * (rapid ? 3 : 1));

    ctx.shadowColor = hurt > 0 ? '#ff3b5c' : rapid ? '#ffc233' : '#00e5ff';
    ctx.shadowBlur = 22 * glow + hurt * 20 + (rapid ? 12 : 0);

    tracePolygon(ctx, 0, 0, r, 6, 0);
    ctx.fillStyle = hurt > 0
      ? `rgba(255, 59, 92, ${0.25 + hurt * 0.4})`
      : rapid ? 'rgba(255, 194, 51, 0.16)' : 'rgba(0, 229, 255, 0.12)';
    ctx.fill();
    ctx.strokeStyle = hurt > 0 ? '#ff5c78' : rapid ? '#ffc233' : '#00e5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.rotate(-p.rotation * 2.2);
    tracePolygon(ctx, 0, 0, r * 0.5, 6, 0);
    ctx.strokeStyle = 'rgba(255, 45, 149, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
    ctx.shadowBlur = 0;
  }

  drawDamageNumbers(ctx) {
    ctx.textAlign = 'center';
    for (let i = 0; i < this.damageNumbers.length; i++) {
      const d = this.damageNumbers[i];
      const t = d.life / d.maxLife;
      ctx.globalAlpha = Math.min(t * 2, 1);

      if (d.critTier === 2) {
        // スーパークリティカルは出現時に拡大してから縮む
        const scale = 1 + (1 - t) * 0.6;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.scale(scale, scale);
        ctx.font = '700 22px Consolas, monospace';
        ctx.shadowColor = '#ff2d95';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#ff2d95';
        ctx.fillText(d.text, 0, 0);
        ctx.restore();
        ctx.shadowBlur = 0;
      } else if (d.critTier === 1) {
        ctx.font = '700 18px Consolas, monospace';
        ctx.fillStyle = '#ffc233';
        ctx.fillText(d.text, d.x, d.y);
      } else {
        ctx.font = '600 13px Consolas, monospace';
        ctx.fillStyle = '#e8fbff';
        ctx.fillText(d.text, d.x, d.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- HUD ---------- */

  updateHud(dt) {
    this.hudTimer += dt;
    if (this.hudTimer < CONFIG.HUD_UPDATE_INTERVAL && !this.hudDirty) return;
    this.hudTimer = 0;
    this.hudDirty = false;

    const h = this.hud;
    const p = this.player;
    const w = this.waveManager;

    h.cash.textContent = formatNumber(this.cash);
    h.coin.textContent = formatNumber(this.coin);
    h.gem.textContent = formatNumber(this.gem);

    h.wave.textContent = w.wave;
    h.remaining.textContent = Math.max(w.remaining, 0);
    h.waveBarFill.style.width = (w.progress * 100).toFixed(1) + '%';

    h.hp.textContent = formatNumber(Math.ceil(p.hp));
    h.hpMax.textContent = formatNumber(Math.ceil(p.stats.maxHp));
    h.hpBarFill.style.width = ((p.hp / p.stats.maxHp) * 100).toFixed(1) + '%';

    // 防御壁バー（未取得時は非表示）
    if (p.maxWallHp > 0) {
      h.wallBar.classList.remove('hidden');
      h.wallBarFill.style.width =
        ((p.wallHp / p.maxWallHp) * 100).toFixed(1) + '%';
    } else {
      h.wallBar.classList.add('hidden');
    }

    // ボスHPバー
    const boss = this.currentBoss;
    if (boss && boss.hp > 0) {
      const ratio = Math.max(boss.hp / boss.maxHp, 0);
      h.bossHpFill.style.width = (ratio * 100).toFixed(1) + '%';
      h.bossHpText.textContent =
        formatNumber(Math.ceil(boss.hp)) + ' / ' + formatNumber(Math.ceil(boss.maxHp));
    }

    h.atk.textContent = formatNumber(p.stats.damage);
    h.aspd.textContent = (1 / p.stats.attackInterval).toFixed(2);
    h.dps.textContent = formatNumber(this.dps);
  }

  updateFps(dt) {
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.hud.fps.textContent =
        Math.round(this.fpsFrames / this.fpsTimer) + ' FPS';
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
  }

  showToast(message) {
    const t = this.hud.toast;
    t.textContent = message;
    t.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
  }
}

/* =========================================================
 * 11. 起動
 * ======================================================= */

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
