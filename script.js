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

  // 1回のupdateで進める最大時間。これを超える分は分割して処理する。
  // 高速時に弾が敵をすり抜けるのを防ぐための上限。
  MAX_SUBSTEP: 0.02,

  // オーバークロック（熱システム）
  HEAT_MAX: 100,
  HEAT_PER_SHOT: 4.0,         // 1射あたりの発熱
  HEAT_DECAY: 4.0,            // 毎秒の自然冷却（攻撃を止めると下がる）
  OVERCLOCK_DURATION: 6,      // 超強化状態の基本秒数
  OVERHEAT_DURATION: 4,       // 反動で弱体化する秒数

  // LAB研究の所要時間の上限。青天井にすると高レベルが数百年になるため必須。
  LAB_MAX_DURATION: 48 * 3600,

  OFFLINE_MAX_HOURS: 8,       // オフライン報酬の上限時間
  OFFLINE_MIN_MINUTES: 1,     // これ未満は報酬なし
});

/** ゲームスピードの選択肢 */
const GAME_SPEEDS = [1, 1.5, 2, 3];

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
  // 永続研究（第4段階）で操作する項目
  bossDamageMul: 1,           // ボスへの与ダメージ倍率
  enemySpeedMul: 1,           // 敵の移動速度倍率
  coinBonus: 1,               // Coin獲得倍率
  startingCash: 0,            // 開始時の所持Cash
  startWave: 1,               // 開始Wave
  gemChance: 0,               // ボス撃破時のGem獲得確率
  // 高Tierアップグレード（第5段階）で操作する項目
  damageMul: 1,               // 最終攻撃力の倍率
  hpMul: 1,                   // 最終最大HPの倍率
  lifesteal: 0,               // 与ダメージのHP吸収率
  critChainChance: 0,         // クリティカル時の追撃発生率
  executeThreshold: 0,        // 残HP割合がこの値以下の敵を即撃破
  // 重力属性（リニューアル：重圧・重力圧縮・重力崩壊）
  gravExecute: 0,             // 重力圧縮の即死ライン（通常敵）
  gravBossExecute: 0,         // 重力圧縮の即死ライン（ボス）
  gravCollapseDamage: 0,      // 重力崩壊で周囲へ与える最大HP割合ダメージ
  gravCollapseRange: 0,       // 重力崩壊の影響半径
  gravCore: 0,                // 重力エフェクト強化（視覚演出の濃さ）
  waveSkipChance: 0,          // Waveを飛ばす確率
  omniStrikeChance: 0,        // 射程内全体攻撃の発生率
  orbRings: 1,                // オーブの軌道リング数
  mineCount: 1,               // 一度に設置する地雷の数
  // LAB（実時間研究・第6段階）で操作する項目
  offlineMul: 1,              // オフライン報酬の倍率
  gemFindMul: 1,              // Gem獲得量の倍率
  // オーバークロック（第8段階）
  heatGainMul: 1,             // 発熱量の倍率
  heatBonusMul: 1,            // 熱による強化幅の倍率
  overclockDuration: 0,       // 超強化状態の延長秒数
  overheatReduction: 0,       // 弱体化時間の短縮秒数
  masteryPowerMul: 0,         // Mastery による超強化の上乗せ
  superOverclock: 0,          // 1 で SUPER OVERCLOCK が解放される
  // 属性コア（第8段階）
  elementPower: 1,            // 属性効果の倍率
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
    id: 'ranged', name: 'アーティラリー', desc: '距離を取って砲撃してくる支援機',
    color: '#a561ff', glow: 'rgba(165,97,255,0.6)', shape: 'hex',
    size: 13, baseHp: 26, baseAtk: 10, baseSpeed: 34,
    cash: 16, coin: 0, exp: 4,
    // stopDistance は必ず BASE_STATS.range(175) より内側にすること。
    // 外側に置くと初期射程では反撃できず詰む（第3段階の不具合）。
    behavior: 'ranged', stopDistance: 150, fireInterval: 2.4,
    weight: 28, minWave: 14,
  },
  {
    id: 'shield', name: 'シールダー', desc: '前方バリアで正面からのダメージを大幅に軽減',
    color: '#4fa8ff', glow: 'rgba(79,168,255,0.6)', shape: 'hex',
    size: 16, baseHp: 40, baseAtk: 14, baseSpeed: 30,
    cash: 20, coin: 0, exp: 5,
    behavior: 'charge', weight: 24, minWave: 20,
    // シールドが正面を向いている間は被ダメージを軽減する（氷・重力で崩しやすい）
    special: { type: 'shield', reduction: 0.75, angle: 1.4 },
  },
  {
    id: 'healer', name: 'メディック', desc: '周囲の味方を持続回復する支援機。最優先で処理したい',
    color: '#3dff9e', glow: 'rgba(61,255,158,0.6)', shape: 'triangle',
    size: 13, baseHp: 34, baseAtk: 8, baseSpeed: 40,
    cash: 24, coin: 1, exp: 6,
    behavior: 'charge', weight: 18, minWave: 30,
    special: { type: 'healer', radius: 130, healPct: 0.04, interval: 0.8 },
  },
  {
    id: 'splitter', name: 'ディバイダー', desc: '撃破されると2体の小型機に分裂する',
    color: '#ff9f3d', glow: 'rgba(255,159,61,0.6)', shape: 'square',
    size: 15, baseHp: 30, baseAtk: 10, baseSpeed: 42,
    cash: 14, coin: 0, exp: 4,
    behavior: 'charge', weight: 22, minWave: 25,
    special: { type: 'splitter', childId: 'splitterling', count: 2 },
  },
  {
    id: 'splitterling', name: 'ディバイダー片', desc: '分裂で生まれた小型機',
    color: '#ffbf7d', glow: 'rgba(255,191,125,0.5)', shape: 'triangle',
    size: 8, baseHp: 8, baseAtk: 5, baseSpeed: 70,
    cash: 3, coin: 0, exp: 1,
    behavior: 'charge', weight: 0, minWave: 999,  // 抽選対象外（分裂専用）
    hidden: true,  // 図鑑には独立種として出さない（親機の一部）
  },
  {
    id: 'brute', name: 'ベヒモス', desc: '極めて高い耐久を持つ超大型機。ノックバックが効かない',
    color: '#ff5c3d', glow: 'rgba(255,92,61,0.7)', shape: 'square',
    size: 26, baseHp: 180, baseAtk: 34, baseSpeed: 20,
    cash: 45, coin: 1, exp: 12,
    behavior: 'charge', weight: 12, minWave: 45,
    special: { type: 'brute', knockbackImmune: true },
  },
  {
    id: 'bomber', name: 'カミカゼ', desc: 'コアへ突撃し、接触すると自爆して大ダメージを与える',
    color: '#ff2d5c', glow: 'rgba(255,45,92,0.7)', shape: 'triangle',
    size: 12, baseHp: 18, baseAtk: 45, baseSpeed: 82,
    cash: 12, coin: 0, exp: 3,
    behavior: 'charge', weight: 16, minWave: 40,
    special: { type: 'bomber', blastRadius: 70 },
  },
  {
    id: 'warper', name: 'ブリンカー', desc: '短距離のテレポートでコアへ一気に近づく',
    color: '#c77dff', glow: 'rgba(199,125,255,0.6)', shape: 'hex',
    size: 12, baseHp: 24, baseAtk: 16, baseSpeed: 46,
    cash: 22, coin: 0, exp: 6,
    behavior: 'charge', weight: 16, minWave: 55,
    special: { type: 'warper', interval: 2.6, distance: 130, minDist: 90 },
  },
  {
    id: 'leech', name: 'サイフォン', desc: '与えたダメージで自己回復し、しぶとく前進する',
    color: '#a561ff', glow: 'rgba(165,97,255,0.6)', shape: 'hex',
    size: 14, baseHp: 46, baseAtk: 12, baseSpeed: 36,
    cash: 20, coin: 0, exp: 5,
    behavior: 'charge', weight: 15, minWave: 60,
    special: { type: 'leech', healOnHitPct: 0.5, regen: 0.015 },
  },
  {
    id: 'boss', name: 'コロッサス', desc: '50Wave毎に現れる超大型個体',
    color: '#ff2d95', glow: 'rgba(255,45,149,0.8)', shape: 'hex',
    size: 46, baseHp: 2600, baseAtk: 120, baseSpeed: 17,
    cash: 900, coin: 3, exp: 100,
    behavior: 'charge', boss: true, weight: 0, minWave: 50,
    // ボスの行動パターン。Waveに応じてどれかが選ばれる（下記 BOSS_PATTERNS）
  },
];

/**
 * ボスの行動パターン。撃破したボスの数に応じて巡回する。
 * この配列へ追加するだけで新しいボス挙動を増やせる。
 */
const BOSS_PATTERNS = [
  {
    id: 'laser', name: 'レーザー掃射',
    color: '#ff2d95',
    // 一定間隔でコアへ狙いをつけ、太いレーザーを発射する
    interval: 4.5, telegraph: 1.2,
    onFire(game, boss) {
      game.fireBossLaser(boss);
    },
  },
  {
    id: 'summon', name: '増援召喚',
    color: '#4fa8ff',
    interval: 6.0, telegraph: 0.8,
    onFire(game, boss) {
      game.bossSummon(boss, 4);
    },
  },
  {
    id: 'barrier', name: '再生シールド',
    color: '#3dff9e',
    interval: 8.0, telegraph: 0.6,
    onFire(game, boss) {
      // 一定時間、被ダメージを大きく軽減するシールドを張る
      boss.bossShieldTimer = 3.0;
      game.spawnParticles(boss.x, boss.y, 20, 160, 0.6, 4, '#3dff9e');
      game.showToast('ボスがシールドを展開', 1600);
    },
  },
  {
    id: 'shockwave', name: '衝撃波',
    color: '#ffc233',
    interval: 5.5, telegraph: 1.0,
    onFire(game, boss) {
      // コアを中心に広がる衝撃波。プレイヤーの攻撃を一時的に阻害する弾幕
      game.bossShockwave(boss);
    },
  },
];

/** ボスが使うパターンを撃破数から決める（複数を巡回） */
function bossPatternsFor(bossKills) {
  // 最初のボスはレーザーのみ。ボスを2体倒すごとに使えるパターンが1つ増える
  const count = Math.min(1 + Math.floor(bossKills / 2), BOSS_PATTERNS.length);
  const out = [];
  for (let i = 0; i < count; i++) out.push(BOSS_PATTERNS[i]);
  return out;
}

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
 * アップグレードの解放段階。到達した最高Waveが requiredWave 以上になると解放される。
 * 段階を増やす場合はこの配列へ追加し、UPGRADES の tier に番号を書くだけでよい。
 */
const UPGRADE_TIERS = [
  { tier: 1,  requiredWave: 0 },
  { tier: 2,  requiredWave: 30 },
  { tier: 3,  requiredWave: 50 },
  { tier: 4,  requiredWave: 100 },
  { tier: 5,  requiredWave: 200 },
  { tier: 6,  requiredWave: 400 },
  { tier: 7,  requiredWave: 600 },
  { tier: 8,  requiredWave: 800 },
  { tier: 9,  requiredWave: 1000 },
  { tier: 10, requiredWave: 1500 },
];

/** tier番号 → 解放に必要なWave */
function tierRequiredWave(tier) {
  for (let i = 0; i < UPGRADE_TIERS.length; i++) {
    if (UPGRADE_TIERS[i].tier === tier) return UPGRADE_TIERS[i].requiredWave;
  }
  return 0;
}

/**
 * アップグレード定義。ショップはこの配列から自動生成される。
 * 追加時はオブジェクトを1つ足すだけでよい（tier で解放段階を指定）。
 */
const UPGRADES = [
  /* ---------------- 攻撃 ---------------- */
  {
    id: 'damage', name: 'Damage', category: 'attack',
    tier: 1,
    level: 0, maxLevel: 6000, baseCost: 8, growth: 1.08,
    description: '攻撃力が増加',
    effect(s, lv) { s.damage += lv * 2; },
    valueText: (lv) => '+' + formatNumber(lv * 2),
  },
  {
    id: 'attackSpeed', name: 'Attack Speed', category: 'attack',
    tier: 1,
    level: 0, maxLevel: 99, baseCost: 30, growth: 1.22,
    description: '攻撃速度が上昇',
    effect(s, lv) { s.attackInterval = BASE_STATS.attackInterval / (1 + lv * 0.04); },
    valueText: (lv) => '+' + (lv * 4) + '%',
  },
  {
    id: 'critChance', name: 'Critical Chance', category: 'attack',
    tier: 1,
    level: 0, maxLevel: 80, baseCost: 50, growth: 1.18,
    description: 'クリティカル発生率（最大80%）',
    effect(s, lv) { s.critChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'critDamage', name: 'Critical Damage', category: 'attack',
    tier: 2,
    level: 0, maxLevel: 150, baseCost: 80, growth: 1.16,
    description: 'クリティカル倍率が上昇',
    effect(s, lv) { s.critMultiplier += lv * 0.05; },
    valueText: (lv) => 'x' + (1.5 + lv * 0.05).toFixed(2),
  },
  {
    id: 'attackRange', name: 'Attack Range', category: 'attack',
    tier: 1,
    level: 0, maxLevel: 79, baseCost: 60, growth: 1.19,
    description: '攻撃範囲が拡大',
    effect(s, lv) { s.range += lv * 4; },
    valueText: (lv) => (175 + lv * 4) + '',
  },
  {
    id: 'damagePerMeter', name: 'Damage Per Meter', category: 'attack',
    tier: 2,
    level: 0, maxLevel: 100, baseCost: 120, growth: 1.20,
    description: '遠い敵ほどダメージ上昇',
    effect(s, lv) { s.damagePerMeter += lv * 0.02; },
    valueText: (lv) => '+' + (lv * 2) + '%/100px',
  },
  {
    id: 'multishotChance', name: 'Multishot Chance', category: 'attack',
    tier: 3,
    level: 0, maxLevel: 40, baseCost: 200, growth: 1.25,
    description: '複数の敵へ同時攻撃する確率',
    effect(s, lv) { s.multishotChance += lv * 0.02; },
    valueText: (lv) => (lv * 2) + '%',
  },
  {
    id: 'multishotTargets', name: 'Multishot Targets', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 5, baseCost: 1000, growth: 1.9,
    description: '同時攻撃数（最大7体）',
    effect(s, lv) { s.multishotTargets += lv; },
    valueText: (lv) => (2 + lv) + '体',
  },
  {
    id: 'rapidFireChance', name: 'Rapid Fire Chance', category: 'attack',
    tier: 3,
    level: 0, maxLevel: 50, baseCost: 300, growth: 1.24,
    description: '高速連射モード発動率',
    effect(s, lv) { s.rapidFireChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'rapidFireDuration', name: 'Rapid Fire Duration', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 20, baseCost: 400, growth: 1.35,
    description: '高速連射の持続時間',
    effect(s, lv) { s.rapidFireDuration += lv * 0.25; },
    valueText: (lv) => (1.5 + lv * 0.25).toFixed(2) + 's',
  },
  {
    id: 'bounceChance', name: 'Bounce Chance', category: 'attack',
    tier: 3,
    level: 0, maxLevel: 40, baseCost: 250, growth: 1.25,
    description: '弾が別の敵へ跳弾する確率',
    effect(s, lv) { s.bounceChance += lv * 0.02; },
    valueText: (lv) => (lv * 2) + '%',
  },
  {
    id: 'bounceCount', name: 'Bounce Count', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 6, baseCost: 800, growth: 1.9,
    description: '跳弾回数（最大7回）',
    effect(s, lv) { s.bounceCount += lv; },
    valueText: (lv) => (1 + lv) + '回',
  },
  {
    id: 'bounceRange', name: 'Bounce Range', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 30, baseCost: 350, growth: 1.3,
    description: '跳弾の索敵距離',
    effect(s, lv) { s.bounceRange += lv * 8; },
    valueText: (lv) => (120 + lv * 8) + '',
  },
  {
    id: 'superCritChance', name: 'Super Crit Chance', category: 'attack',
    tier: 5,
    level: 0, maxLevel: 30, baseCost: 1500, growth: 1.35,
    description: 'クリティカルがスーパー化する確率',
    effect(s, lv) { s.superCritChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'superCritDamage', name: 'Super Crit Damage', category: 'attack',
    tier: 5,
    level: 0, maxLevel: 100, baseCost: 2000, growth: 1.3,
    description: 'スーパークリティカル倍率',
    effect(s, lv) { s.superCritMultiplier += lv * 0.1; },
    valueText: (lv) => 'x' + (3 + lv * 0.1).toFixed(1),
  },
  {
    id: 'armorBreakChance', name: 'Armor Break Chance', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 50, baseCost: 600, growth: 1.28,
    description: '敵の防御を低下させる確率',
    effect(s, lv) { s.armorBreakChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'armorBreakMult', name: 'Armor Break Multiplier', category: 'attack',
    tier: 4,
    level: 0, maxLevel: 50, baseCost: 800, growth: 1.3,
    description: '防御低下中の被ダメージ倍率',
    effect(s, lv) { s.armorBreakMultiplier += lv * 0.03; },
    valueText: (lv) => 'x' + (1.25 + lv * 0.03).toFixed(2),
  },

  /* ---------------- 防御 ---------------- */
  {
    id: 'health', name: 'Health', category: 'defense',
    tier: 1,
    level: 0, maxLevel: 2000, baseCost: 12, growth: 1.10,
    description: '最大HPが増加',
    effect(s, lv) { s.maxHp += lv * 20; },
    valueText: (lv) => formatNumber(100 + lv * 20),
  },
  {
    id: 'healthRegen', name: 'Health Regen', category: 'defense',
    tier: 1,
    level: 0, maxLevel: 200, baseCost: 40, growth: 1.18,
    description: 'HPが毎秒自動回復',
    effect(s, lv) { s.hpRegen += lv * 0.5; },
    valueText: (lv) => '+' + (lv * 0.5).toFixed(1) + '/s',
  },
  {
    id: 'defense', name: 'Defense', category: 'defense',
    tier: 1,
    level: 0, maxLevel: 500, baseCost: 60, growth: 1.16,
    description: '被ダメージを軽減',
    effect(s, lv) { s.defense += lv; },
    valueText: (lv) => '-' + formatNumber(lv),
  },
  {
    id: 'orbCount', name: 'Orb', category: 'defense',
    tier: 2,
    level: 0, maxLevel: 8, baseCost: 500, growth: 2.1,
    description: '周回する防衛オーブを展開',
    effect(s, lv) { s.orbCount += lv; },
    valueText: (lv) => lv + '基',
  },
  {
    id: 'orbDamage', name: 'Orb Damage', category: 'defense',
    tier: 2,
    level: 0, maxLevel: 500, baseCost: 200, growth: 1.15,
    description: 'オーブの接触ダメージ',
    effect(s, lv) { s.orbDamage += lv * 6; },
    valueText: (lv) => formatNumber(lv * 6),
  },
  {
    id: 'orbSpeed', name: 'Orb Speed', category: 'defense',
    tier: 3,
    level: 0, maxLevel: 60, baseCost: 300, growth: 1.2,
    description: 'オーブの回転速度',
    effect(s, lv) { s.orbSpeed += lv * 0.08; },
    valueText: (lv) => (1.6 + lv * 0.08).toFixed(2) + ' rad/s',
  },
  {
    id: 'orbBossDamage', name: 'Orb Boss Damage', category: 'defense',
    tier: 5,
    level: 0, maxLevel: 40, baseCost: 2500, growth: 1.35,
    description: 'オーブがボスへ割合ダメージ',
    effect(s, lv) { s.orbBossDamage += lv * 0.001; },
    valueText: (lv) => (lv * 0.1).toFixed(1) + '%/hit',
  },
  {
    id: 'mineDamage', name: 'Mine Damage', category: 'defense',
    tier: 3,
    level: 0, maxLevel: 500, baseCost: 400, growth: 1.16,
    description: '自動設置される地雷の威力',
    effect(s, lv) { s.mineDamage += lv * 14; },
    valueText: (lv) => formatNumber(lv * 14),
  },
  {
    id: 'mineDecay', name: 'Mine Decay', category: 'defense',
    tier: 4,
    level: 0, maxLevel: 40, baseCost: 350, growth: 1.22,
    description: '地雷の起爆までの時間を短縮',
    effect(s, lv) { s.mineDecay = Math.max(3.0 - lv * 0.06, 0.5); },
    valueText: (lv) => Math.max(3.0 - lv * 0.06, 0.5).toFixed(2) + 's',
  },
  {
    id: 'shockwaveSize', name: 'Shockwave Size', category: 'defense',
    tier: 3,
    level: 0, maxLevel: 60, baseCost: 450, growth: 1.2,
    description: '爆発の範囲が拡大',
    effect(s, lv) { s.shockwaveSize += lv * 4; },
    valueText: (lv) => (60 + lv * 4) + '',
  },
  {
    id: 'wallHealth', name: 'Wall Health', category: 'defense',
    tier: 3,
    level: 0, maxLevel: 1000, baseCost: 600, growth: 1.14,
    description: 'コアを覆う防御壁を展開',
    effect(s, lv) { s.wallHealth += lv * 40; },
    valueText: (lv) => formatNumber(lv * 40),
  },
  {
    id: 'wallRegen', name: 'Wall Regen', category: 'defense',
    tier: 4,
    level: 0, maxLevel: 200, baseCost: 500, growth: 1.18,
    description: '防御壁が毎秒回復',
    effect(s, lv) { s.wallRegen += lv * 2; },
    valueText: (lv) => '+' + formatNumber(lv * 2) + '/s',
  },
  {
    id: 'wallInvincible', name: 'Wall Invincible', category: 'defense',
    tier: 5,
    level: 0, maxLevel: 30, baseCost: 900, growth: 1.3,
    description: '壁の被弾後の無敵時間',
    effect(s, lv) { s.wallInvincible += lv * 0.04; },
    valueText: (lv) => (0.4 + lv * 0.04).toFixed(2) + 's',
  },
  {
    id: 'wallThorns', name: 'Wall Thorns', category: 'defense',
    tier: 4,
    level: 0, maxLevel: 300, baseCost: 700, growth: 1.16,
    description: '壁に触れた敵へ反射ダメージ',
    effect(s, lv) { s.wallThorns += lv * 10; },
    valueText: (lv) => formatNumber(lv * 10),
  },
  {
    id: 'wallFortification', name: 'Wall Fortification', category: 'defense',
    tier: 5,
    level: 0, maxLevel: 50, baseCost: 1200, growth: 1.3,
    description: '壁の最大耐久を倍率で強化',
    effect(s, lv) { s.wallFortification += lv * 0.1; },
    valueText: (lv) => 'x' + (1 + lv * 0.1).toFixed(1),
  },
  {
    id: 'garlicThorns', name: 'Garlic Thorns', category: 'defense',
    tier: 4,
    level: 0, maxLevel: 300, baseCost: 800, growth: 1.16,
    description: '近接した敵へ継続ダメージ',
    effect(s, lv) { s.garlicThorns += lv * 8; },
    valueText: (lv) => formatNumber(lv * 8) + '/s',
  },

  /* ---------------- ユーティリティ ---------------- */
  {
    id: 'cashBonus', name: 'Cash Bonus', category: 'utility',
    tier: 1,
    level: 0, maxLevel: 200, baseCost: 100, growth: 1.22,
    description: '獲得Cashが増加',
    effect(s, lv) { s.cashBonus += lv * 0.05; },
    valueText: (lv) => '+' + (lv * 5) + '%',
  },
  {
    id: 'cashPerWave', name: 'Cash Per Wave', category: 'utility',
    tier: 2,
    level: 0, maxLevel: 100, baseCost: 150, growth: 1.25,
    description: 'Waveクリア時にCash獲得',
    effect(s, lv) { s.cashPerWave += lv * 10; },
    valueText: (lv) => '+$' + formatNumber(lv * 10),
  },
  {
    id: 'coinPerKill', name: 'Coin Per Kill', category: 'utility',
    tier: 2,
    level: 0, maxLevel: 50, baseCost: 500, growth: 1.35,
    description: '撃破時にCoin獲得（期待値）',
    effect(s, lv) { s.coinPerKill += lv * 0.01; },
    valueText: (lv) => (lv * 0.01).toFixed(2) + '/kill',
  },
  {
    id: 'coinPerWave', name: 'Coin Per Wave', category: 'utility',
    tier: 4,
    level: 0, maxLevel: 50, baseCost: 800, growth: 1.4,
    description: 'Waveクリア時にCoin獲得',
    effect(s, lv) { s.coinPerWave += lv * 0.2; },
    valueText: (lv) => '+' + (lv * 0.2).toFixed(1) + '◎',
  },
  {
    id: 'interest', name: 'Interest', category: 'utility',
    tier: 2,
    level: 0, maxLevel: 30, baseCost: 400, growth: 1.4,
    description: 'Waveクリア時に所持Cashの利息',
    effect(s, lv) { s.interest += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'maxInterest', name: 'Max Interest', category: 'utility',
    tier: 2,
    level: 0, maxLevel: 50, baseCost: 600, growth: 1.35,
    description: '利息の上限額が増加',
    effect(s, lv) { s.maxInterestCap += lv * 250; },
    valueText: (lv) => '$' + formatNumber(100 + lv * 250),
  },
  {
    id: 'bossPackage', name: 'Boss Package', category: 'utility',
    tier: 4,
    level: 0, maxLevel: 20, baseCost: 1200, growth: 1.4,
    description: 'ボス撃破時に補給パッケージ',
    effect(s, lv) { s.bossPackage += lv; },
    valueText: (lv) => lv + '個',
  },
  {
    id: 'packageChance', name: 'Package Chance', category: 'utility',
    tier: 3,
    level: 0, maxLevel: 40, baseCost: 700, growth: 1.3,
    description: '敵がパッケージを落とす確率',
    effect(s, lv) { s.packageChance += lv * 0.005; },
    valueText: (lv) => (lv * 0.5).toFixed(1) + '%',
  },
  {
    id: 'packageHeal', name: 'Package Heal', category: 'utility',
    tier: 3,
    level: 0, maxLevel: 50, baseCost: 500, growth: 1.28,
    description: 'パッケージのHP回復量',
    effect(s, lv) { s.packageHeal += lv * 0.01; },
    valueText: (lv) => ((0.05 + lv * 0.01) * 100).toFixed(0) + '%',
  },
  {
    id: 'packageMax', name: 'Package Max', category: 'utility',
    tier: 4,
    level: 0, maxLevel: 12, baseCost: 900, growth: 1.45,
    description: '同時に存在できるパッケージ数',
    effect(s, lv) { s.packageMax += lv; },
    valueText: (lv) => (3 + lv) + '個',
  },
  {
    id: 'enemyAttackSkip', name: 'Enemy Attack Skip', category: 'utility',
    tier: 3,
    level: 0, maxLevel: 40, baseCost: 700, growth: 1.35,
    description: '敵の攻撃を無効化する確率',
    effect(s, lv) { s.enemyAttackSkip += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'enemyHpSkip', name: 'Enemy HP Skip', category: 'utility',
    tier: 4,
    level: 0, maxLevel: 40, baseCost: 900, growth: 1.35,
    description: '敵がHP半減で出現する確率',
    effect(s, lv) { s.enemyHpSkip += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },

  {
    id: 'heatBonus', name: 'Heat Amplifier', category: 'attack',
    tier: 3,
    unlockWave: 100,
    level: 0, maxLevel: 60, baseCost: 900, growth: 1.24,
    description: '熱による強化幅が増加する',
    effect(s, lv) { s.heatBonusMul += lv * 0.05; },
    valueText: (lv) => 'x' + (1 + lv * 0.05).toFixed(2),
  },
  {
    id: 'heatGain', name: 'Heat Generator', category: 'attack',
    tier: 4,
    unlockWave: 0,
    level: 0, maxLevel: 40, baseCost: 2500, growth: 1.28,
    description: '発熱量が増えオーバークロックしやすくなる',
    effect(s, lv) { s.heatGainMul += lv * 0.05; },
    valueText: (lv) => '+' + (lv * 5) + '%',
  },
  {
    id: 'overclockDuration', name: 'Overclock Duration', category: 'attack',
    tier: 5,
    unlockWave: 250,
    level: 0, maxLevel: 40, baseCost: 30000, growth: 1.32,
    description: 'オーバークロックの持続時間が延びる',
    effect(s, lv) { s.overclockDuration += lv * 0.25; },
    valueText: (lv) => '+' + (lv * 0.25).toFixed(2) + 's',
  },
  {
    id: 'overheatReduction', name: 'Coolant Purge', category: 'defense',
    tier: 5,
    unlockWave: 500,
    level: 0, maxLevel: 30, baseCost: 30000, growth: 1.32,
    description: 'オーバーヒートの時間が短縮される',
    effect(s, lv) { s.overheatReduction += lv * 0.1; },
    valueText: (lv) => '-' + (lv * 0.1).toFixed(1) + 's',
  },
  {
    id: 'elementPower', name: 'Element Amplifier', category: 'special',
    tier: 6,
    unlockWave: 750,
    level: 0, maxLevel: 60, baseCost: 200000, growth: 1.30,
    description: '属性コアの効果が増幅される',
    effect(s, lv) { s.elementPower += lv * 0.05; },
    valueText: (lv) => 'x' + (1 + lv * 0.05).toFixed(2),
  },

  /* ---------- 高Tier（第5段階で追加） ---------- */
  {
    id: 'damageMultiplier', name: 'Damage Multiplier', category: 'attack',
    tier: 5,
    level: 0, maxLevel: 100, baseCost: 25000, growth: 1.32,
    description: '最終攻撃力に倍率がかかる',
    effect(s, lv) { s.damageMul += lv * 0.1; },
    valueText: (lv) => 'x' + (1 + lv * 0.1).toFixed(1),
  },
  {
    id: 'hpMultiplier', name: 'Health Multiplier', category: 'defense',
    tier: 5,
    level: 0, maxLevel: 100, baseCost: 25000, growth: 1.32,
    description: '最終最大HPに倍率がかかる',
    effect(s, lv) { s.hpMul += lv * 0.1; },
    valueText: (lv) => 'x' + (1 + lv * 0.1).toFixed(1),
  },
  {
    id: 'critChain', name: 'Critical Chain', category: 'attack',
    tier: 6,
    level: 0, maxLevel: 50, baseCost: 120000, growth: 1.34,
    description: 'クリティカル時に追撃が発生する確率',
    effect(s, lv) { s.critChainChance += lv * 0.015; },
    valueText: (lv) => (lv * 1.5).toFixed(1) + '%',
  },
  {
    id: 'lifesteal', name: 'Lifesteal', category: 'defense',
    tier: 6,
    level: 0, maxLevel: 60, baseCost: 150000, growth: 1.33,
    description: '与ダメージの一部をHPとして吸収',
    effect(s, lv) { s.lifesteal += lv * 0.002; },
    valueText: (lv) => (lv * 0.2).toFixed(1) + '%',
  },
  {
    id: 'orbRings', name: 'Orbital Ring', category: 'defense',
    tier: 7,
    level: 0, maxLevel: 3, baseCost: 900000, growth: 3.2,
    description: 'オーブの軌道リングが増える',
    effect(s, lv) { s.orbRings += lv; },
    valueText: (lv) => (1 + lv) + '重',
  },
  {
    id: 'mineCluster', name: 'Mine Cluster', category: 'defense',
    tier: 7,
    level: 0, maxLevel: 8, baseCost: 700000, growth: 1.9,
    description: '一度に設置する地雷の数',
    effect(s, lv) { s.mineCount += lv; },
    valueText: (lv) => (1 + lv) + '個',
  },
  {
    id: 'execute', name: 'Execution', category: 'attack',
    tier: 8,
    level: 0, maxLevel: 40, baseCost: 5000000, growth: 1.38,
    description: '残HPが一定以下の敵を即撃破（ボス除く）',
    effect(s, lv) { s.executeThreshold += lv * 0.005; },
    valueText: (lv) => '残HP ' + (lv * 0.5).toFixed(1) + '% 以下',
  },
  {
    id: 'waveSkip', name: 'Wave Skip', category: 'utility',
    tier: 8,
    level: 0, maxLevel: 30, baseCost: 6000000, growth: 1.42,
    description: 'Waveを報酬付きで飛ばす確率',
    effect(s, lv) { s.waveSkipChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'goldenTouch', name: 'Golden Touch', category: 'utility',
    tier: 9,
    level: 0, maxLevel: 100, baseCost: 40000000, growth: 1.36,
    description: 'Cash獲得量が大幅に増加',
    effect(s, lv) { s.cashBonus += lv * 0.5; },
    valueText: (lv) => '+' + (lv * 50) + '%',
  },
  {
    id: 'timeDilation', name: 'Time Dilation', category: 'utility',
    tier: 9,
    level: 0, maxLevel: 40, baseCost: 50000000, growth: 1.4,
    description: '敵全体の移動速度を低下させる',
    effect(s, lv) { s.enemySpeedMul -= lv * 0.01; },
    valueText: (lv) => '-' + lv + '%',
  },
  {
    id: 'omniStrike', name: 'Omni Strike', category: 'attack',
    tier: 10,
    level: 0, maxLevel: 50, baseCost: 400000000, growth: 1.42,
    description: '攻撃時に射程内の敵全てを攻撃する確率',
    effect(s, lv) { s.omniStrikeChance += lv * 0.01; },
    valueText: (lv) => lv + '%',
  },
  {
    id: 'infinityCore', name: 'Infinity Core', category: 'defense',
    tier: 10,
    level: 0, maxLevel: 200, baseCost: 500000000, growth: 1.3,
    description: '攻撃力・HP・防御が同時に上昇する',
    effect(s, lv) {
      s.damageMul += lv * 0.05;
      s.hpMul += lv * 0.05;
      s.defense += lv * 20;
    },
    valueText: (lv) => 'x' + (1 + lv * 0.05).toFixed(2) + ' / 防御+' + formatNumber(lv * 20),
  },
];

/**
 * 永続研究。Coinで購入し、セーブデータに保存されて次の周回へ引き継がれる。
 * effect は BASE_STATS のコピーに対して適用され、その結果へ UPGRADES が乗る。
 * ショップ同様、この配列へ追加するだけでUIが自動生成される。
 */
const RESEARCH = [
  {
    id: 'coreDamage', name: 'コア出力', tier: 1, level: 0, maxLevel: 200,
    baseCost: 3, growth: 1.16, description: '基礎攻撃力が永続的に増加',
    effect(s, lv) { s.damage += lv * 2; },
    valueText: (lv) => '攻撃力 +' + formatNumber(lv * 2),
  },
  {
    id: 'coreHealth', name: '装甲強化', tier: 1, level: 0, maxLevel: 200,
    baseCost: 3, growth: 1.16, description: '基礎HPが永続的に増加',
    effect(s, lv) { s.maxHp += lv * 25; },
    valueText: (lv) => 'HP +' + formatNumber(lv * 25),
  },
  {
    id: 'coreRange', name: '照準拡張', tier: 1, level: 0, maxLevel: 60,
    baseCost: 6, growth: 1.20, description: '基礎射程が永続的に拡大',
    effect(s, lv) { s.range += lv * 3; },
    valueText: (lv) => '射程 +' + (lv * 3),
  },
  {
    id: 'coreAttackSpeed', name: '冷却機構', tier: 1, level: 0, maxLevel: 50,
    baseCost: 8, growth: 1.22, description: '基礎攻撃速度が上昇',
    effect(s, lv) { s.attackInterval = s.attackInterval / (1 + lv * 0.02); },
    valueText: (lv) => '攻撃速度 +' + (lv * 2) + '%',
  },
  {
    id: 'coreDefense', name: '反応装甲', tier: 1, level: 0, maxLevel: 100,
    baseCost: 5, growth: 1.18, description: '基礎防御力が永続的に増加',
    effect(s, lv) { s.defense += lv; },
    valueText: (lv) => '防御 +' + lv,
  },
  {
    id: 'coreRegen', name: '自己修復', tier: 1, level: 0, maxLevel: 100,
    baseCost: 6, growth: 1.18, description: 'HPの自動回復量が増加',
    effect(s, lv) { s.hpRegen += lv * 0.3; },
    valueText: (lv) => '回復 +' + (lv * 0.3).toFixed(1) + '/s',
  },
  {
    id: 'startingCash', name: '初期資金', tier: 2, level: 0, maxLevel: 100,
    baseCost: 4, growth: 1.19, description: '開始時に所持しているCash',
    effect(s, lv) { s.startingCash += lv * 50; },
    valueText: (lv) => '$' + formatNumber(lv * 50),
  },
  {
    id: 'cashMastery', name: '資源精製', tier: 1, level: 0, maxLevel: 100,
    baseCost: 7, growth: 1.20, description: 'Cash獲得量が増加',
    effect(s, lv) { s.cashBonus += lv * 0.05; },
    valueText: (lv) => 'Cash +' + (lv * 5) + '%',
  },
  {
    id: 'coinMastery', name: '通貨鋳造', tier: 2, level: 0, maxLevel: 100,
    baseCost: 10, growth: 1.24, description: 'Coin獲得量が増加',
    effect(s, lv) { s.coinBonus += lv * 0.05; },
    valueText: (lv) => 'Coin +' + (lv * 5) + '%',
  },
  {
    id: 'interestMastery', name: '複利運用', tier: 2, level: 0, maxLevel: 40,
    baseCost: 12, growth: 1.28, description: 'Waveクリア時の利息が増加',
    effect(s, lv) { s.interest += lv * 0.005; s.maxInterestCap += lv * 200; },
    valueText: (lv) => '利息 +' + (lv * 0.5).toFixed(1) + '%',
  },
  {
    id: 'bossSlayer', name: '巨人殺し', tier: 5, level: 0, maxLevel: 60,
    baseCost: 15, growth: 1.26, description: 'ボスへの与ダメージが増加',
    effect(s, lv) { s.bossDamageMul += lv * 0.05; },
    valueText: (lv) => 'ボス与ダメ +' + (lv * 5) + '%',
  },
  {
    id: 'overclockMastery', name: 'Overclock Mastery', tier: 8, unlockWave: 750,
    level: 0, maxLevel: 5,
    baseCost: 400, growth: 3.0,
    description: 'オーバークロックを段階的に進化させる（Lv5でSUPER解放）',
    effect(s, lv) {
      if (lv >= 2) s.masteryPowerMul += 0.25;
      if (lv >= 3) s.overclockDuration += 3;
      if (lv >= 4) s.overheatReduction += 1.5;
      if (lv >= 5) s.superOverclock = 1;
    },
    valueText: (lv) => {
      const t = ['未研究', '基本', '倍率アップ', '持続延長', 'ヒート短縮', 'SUPER解放'];
      return 'Lv' + lv + ' ' + t[Math.min(lv, 5)];
    },
  },
  {
    id: 'enemySlow', name: '重力干渉', tier: 9, level: 0, maxLevel: 30,
    baseCost: 20, growth: 1.30, description: '敵全体の移動速度を低下',
    effect(s, lv) { s.enemySpeedMul -= lv * 0.01; },
    valueText: (lv) => '敵速度 -' + lv + '%',
  },
  {
    id: 'startWave', name: '戦域転送', tier: 3, level: 0, maxLevel: 40,
    baseCost: 25, growth: 1.35,
    description: '選択できる開始Waveの上限を解放（設定から変更）',
    effect(s, lv) { s.startWave += lv; },
    valueText: (lv) => 'Wave ' + (1 + lv) + ' まで解放',
  },
  {
    id: 'orbMastery', name: '衛星兵装', tier: 2, level: 0, maxLevel: 3,
    baseCost: 60, growth: 2.4, description: '開始時からオーブを保有',
    effect(s, lv) { s.orbCount += lv; s.orbDamage += lv * 20; },
    valueText: (lv) => 'オーブ ' + lv + '基',
  },
  {
    id: 'gemFinder', name: '結晶探知', tier: 5, level: 0, maxLevel: 25,
    baseCost: 40, growth: 1.35, description: 'ボス撃破時のGem獲得率',
    effect(s, lv) { s.gemChance += lv * 0.04; },
    valueText: (lv) => 'Gem率 ' + (lv * 4) + '%',
  },
  {
    id: 'packageMastery', name: '補給網', tier: 3, level: 0, maxLevel: 50,
    baseCost: 14, growth: 1.24, description: 'パッケージのドロップ率と効果',
    effect(s, lv) { s.packageChance += lv * 0.002; s.packageHeal += lv * 0.004; },
    valueText: (lv) => 'ドロップ +' + (lv * 0.2).toFixed(1) + '%',
  },
];

/* ---------------------------------------------------------
 * LAB（実時間研究）
 * ------------------------------------------------------- */

/** 研究スロットの解放費用（Gem）。index 0 は最初から使える枠 */
const LAB_SLOT_COSTS = [0, 60, 180, 450, 1000];

/** Gemによる時短の単価: この秒数ごとに1Gem */
const LAB_SPEEDUP_SECONDS_PER_GEM = 600;

/** 高Wave到達で得られるGem。到達済みの節目は meta.gemMilestones に記録される */
const GEM_MILESTONES = [
  { wave: 10, gem: 0, frag: 1 },
  { wave: 25, gem: 2, frag: 1 },
  { wave: 50, gem: 5, frag: 2 },
  { wave: 100, gem: 12, frag: 3 },
  { wave: 200, gem: 30, frag: 4 },
  { wave: 400, gem: 70, frag: 6 },
  { wave: 600, gem: 120, frag: 8 },
  { wave: 800, gem: 200, frag: 10 },
  { wave: 1000, gem: 350, frag: 14 },
  { wave: 1500, gem: 700, frag: 20 },
];

/**
 * LAB研究。Coinを支払って着手し、実時間の経過で完了する。
 * ゲームを閉じている間も進行する（完了時刻をセーブデータへ保持）。
 * この配列へ追加するだけでLAB画面へ自動的に並ぶ。
 */
const LAB_RESEARCH = [
  /* ---- 攻撃 ---- */
  {
    id: 'labAttackSpeed', name: '駆動系最適化', category: 'attack', tier: 1,
    level: 0, maxLevel: 60,
    baseCost: 40, costGrowth: 1.30,
    baseDuration: 120, durationGrowth: 1.24,
    description: '攻撃速度が上昇する',
    effect(s, lv) { s.attackInterval = s.attackInterval / (1 + lv * 0.02); },
    valueText: (lv) => '攻撃速度 +' + (lv * 2) + '%',
  },
  {
    id: 'labDamage', name: '砲身精錬', category: 'attack', tier: 1,
    level: 0, maxLevel: 60,
    baseCost: 50, costGrowth: 1.30,
    baseDuration: 150, durationGrowth: 1.24,
    description: '攻撃力に倍率がかかる',
    effect(s, lv) { s.damageMul += lv * 0.05; },
    valueText: (lv) => 'ダメージ +' + (lv * 5) + '%',
  },
  {
    id: 'labCritChance', name: '弱点解析', category: 'attack', tier: 1,
    level: 0, maxLevel: 25,
    baseCost: 90, costGrowth: 1.34,
    baseDuration: 300, durationGrowth: 1.26,
    description: 'クリティカル率が上昇する',
    effect(s, lv) { s.critChance += lv * 0.03; },
    valueText: (lv) => 'クリ率 +' + (lv * 3) + '%',
  },
  {
    id: 'labCritDamage', name: '貫通弾頭', category: 'attack', tier: 2,
    level: 0, maxLevel: 40,
    baseCost: 110, costGrowth: 1.32,
    baseDuration: 330, durationGrowth: 1.24,
    description: 'クリティカル倍率が上昇する',
    effect(s, lv) { s.critMultiplier += lv * 0.08; },
    valueText: (lv) => 'クリダメ +' + (lv * 8) + '%',
  },
  {
    id: 'labRange', name: '広域照準', category: 'attack', tier: 1,
    level: 0, maxLevel: 40,
    baseCost: 70, costGrowth: 1.30,
    baseDuration: 240, durationGrowth: 1.22,
    description: '攻撃範囲が拡大する',
    effect(s, lv) { s.range += lv * 8; },
    valueText: (lv) => '射程 +' + (lv * 8),
  },

  /* ---- 防御 ---- */
  {
    id: 'labHealth', name: '構造補強', category: 'defense', tier: 1,
    level: 0, maxLevel: 60,
    baseCost: 50, costGrowth: 1.30,
    baseDuration: 150, durationGrowth: 1.24,
    description: '最大HPに倍率がかかる',
    effect(s, lv) { s.hpMul += lv * 0.08; },
    valueText: (lv) => 'HP +' + (lv * 8) + '%',
  },
  {
    id: 'labDefense', name: '複合装甲', category: 'defense', tier: 1,
    level: 0, maxLevel: 50,
    baseCost: 80, costGrowth: 1.31,
    baseDuration: 270, durationGrowth: 1.23,
    description: '防御力が上昇する',
    effect(s, lv) { s.defense += lv * 10; },
    valueText: (lv) => '防御 +' + formatNumber(lv * 10),
  },
  {
    id: 'labWallHealth', name: '障壁増幅', category: 'defense', tier: 3,
    level: 0, maxLevel: 40,
    baseCost: 120, costGrowth: 1.33,
    baseDuration: 360, durationGrowth: 1.24,
    description: '防御壁の耐久倍率が上昇する',
    effect(s, lv) { s.wallFortification += lv * 0.1; },
    valueText: (lv) => '壁HP +' + (lv * 10) + '%',
  },
  {
    id: 'labOrbSpeed', name: '軌道加速', category: 'defense', tier: 3,
    level: 0, maxLevel: 40,
    baseCost: 100, costGrowth: 1.32,
    baseDuration: 300, durationGrowth: 1.22,
    description: 'オーブの回転速度が上昇する',
    effect(s, lv) { s.orbSpeed += lv * 0.08; },
    valueText: (lv) => 'オーブ速度 +' + (lv * 5) + '%',
  },

  /* ---- 経済 ---- */
  {
    id: 'labCoin', name: '鋳造効率', category: 'economy', tier: 2,
    level: 0, maxLevel: 50,
    baseCost: 100, costGrowth: 1.33,
    baseDuration: 420, durationGrowth: 1.24,
    description: 'Coin獲得量が増加する',
    effect(s, lv) { s.coinBonus += lv * 0.1; },
    valueText: (lv) => 'Coin +' + (lv * 10) + '%',
  },
  {
    id: 'labCash', name: '資源循環', category: 'economy', tier: 1,
    level: 0, maxLevel: 60,
    baseCost: 60, costGrowth: 1.31,
    baseDuration: 210, durationGrowth: 1.23,
    description: 'Cash獲得量が増加する',
    effect(s, lv) { s.cashBonus += lv * 0.15; },
    valueText: (lv) => 'Cash +' + (lv * 15) + '%',
  },
  {
    id: 'labInterest', name: '金融演算', category: 'economy', tier: 2,
    level: 0, maxLevel: 30,
    baseCost: 150, costGrowth: 1.36,
    baseDuration: 480, durationGrowth: 1.26,
    description: 'Waveクリア時の利息が増加する',
    effect(s, lv) { s.interest += lv * 0.01; s.maxInterestCap += lv * 500; },
    valueText: (lv) => '利息 +' + lv + '%',
  },
  {
    id: 'labOffline', name: '自律運転', category: 'economy', tier: 4,
    level: 0, maxLevel: 30,
    baseCost: 130, costGrowth: 1.35,
    baseDuration: 600, durationGrowth: 1.24,
    description: 'オフライン報酬が増加する',
    effect(s, lv) { s.offlineMul += lv * 0.15; },
    valueText: (lv) => 'オフライン +' + (lv * 15) + '%',
  },

  /* ---- 特殊 ---- */
  {
    id: 'labBoss', name: '巨獣解剖', category: 'special', tier: 5,
    level: 0, maxLevel: 40,
    baseCost: 200, costGrowth: 1.36,
    baseDuration: 720, durationGrowth: 1.26,
    description: 'ボスへの与ダメージが増加する',
    effect(s, lv) { s.bossDamageMul += lv * 0.1; },
    valueText: (lv) => 'ボス与ダメ +' + (lv * 10) + '%',
  },
  {
    id: 'labGem', name: '結晶精製', category: 'special', tier: 5,
    level: 0, maxLevel: 20,
    baseCost: 300, costGrowth: 1.42,
    baseDuration: 900, durationGrowth: 1.30,
    description: 'Gem獲得量が増加する',
    effect(s, lv) { s.gemFindMul += lv * 0.1; },
    valueText: (lv) => 'Gem +' + (lv * 10) + '%',
  },
];

const LAB_CATEGORIES = [
  { id: 'attack', label: '攻撃' },
  { id: 'defense', label: '防御' },
  { id: 'economy', label: '経済' },
  { id: 'special', label: '特殊' },
];

/* ---------------------------------------------------------
 * 属性コア
 * ------------------------------------------------------- */

/**
 * 属性コア。周回開始時に選択し、戦い方そのものを変える。
 *   stats   : 常時かかるステータス補正
 *   onHit   : 弾が敵に当たったときの追加効果
 *   onKill  : 敵を倒したときの追加効果
 *   passive : 毎フレームの効果（引き寄せ等）
 * 追加する場合はこの配列へオブジェクトを1つ足すだけでよい。
 */
/**
 * 属性コア。解放条件・熟練度・専用研究まで含めてこの配列で完結する。
 *   unlockWave : 最高到達Waveがこの値に達すると解放
 *   expTable   : 各レベルに必要な累計撃破数
 *   baseParams : 効果の基準値。レベル特典と専用研究がこれを倍率で書き換える
 *   levelPerks : index が到達レベル。mul は倍率、set は上書き
 *   research   : 専用研究（Coinで購入する即時強化）
 * 新しい属性はこの配列へ1つ追加するだけでUI・研究・解放判定へ反映される。
 */
const ELEMENT_EXP_TABLE = [0, 1000, 5000, 20000, 100000];

/**
 * 属性の解放費用（Core Fragment）。
 * 何番目に解放するかで決まるので、どの属性を先に取るかは自由。
 * 属性を増やす場合はこの配列の末尾へ追加する。
 */
const ELEMENT_UNLOCK_COSTS = [3, 5, 8, 12, 18];

/** 属性レベルアップの費用（Lv1→2, 2→3, 3→4, 4→5）の既定値 */
const DEFAULT_LEVEL_COST = [2, 4, 7, 10];

/**
 * 重力属性の調整用定数。倍率・数値はすべてここで一元管理する。
 * バランス調整はこの定数を触るだけで完結するようにしている。
 */
const GRAVITY = {
  // ---- 重圧（Gravity Pressure）----
  // プレイヤーからの距離（正規化：0=至近, 1=圧力場の外縁）に対する被ダメージ倍率。
  // 外縁100% → 中距離120% → 近距離150% → 至近200%。間は線形補間する。
  pressureZones: [
    { d: 1.00, mul: 1.00 },
    { d: 0.66, mul: 1.20 },
    { d: 0.33, mul: 1.50 },
    { d: 0.00, mul: 2.00 },
  ],
  pressureRangeFactor: 1.15,   // 射程の何倍までを圧力場とみなすか

  // ---- 重力圧縮（Gravity Compression）----
  executeNormal: 0.15,         // 通常敵：残HP15%以下で圧壊
  executeBoss: 0.03,           // ボス：残HP3%以下で圧壊
  executeNormalCap: 0.40,      // 研究で伸ばせる上限（通常）
  executeBossCap: 0.12,        // 研究で伸ばせる上限（ボス）

  // ---- 重力崩壊（Gravity Collapse）----
  collapseRange: 130,          // 崩壊の影響半径（基準値）
  collapseDamagePct: 0.12,     // 周囲の敵へ与える「最大HP」割合ダメージ
  collapseTriggerDist: 170,    // プレイヤーからこの距離以内での撃破が崩壊の対象
};

/** 正規化距離（0=至近, 1=外縁）から重圧の基準倍率を線形補間で求める */
function gravityPressureMul(nd) {
  const z = GRAVITY.pressureZones;
  if (nd >= z[0].d) return z[0].mul;
  if (nd <= z[z.length - 1].d) return z[z.length - 1].mul;
  for (let i = 0; i < z.length - 1; i++) {
    const a = z[i];
    const b = z[i + 1];   // a.d > b.d
    if (nd <= a.d && nd >= b.d) {
      const t = (a.d - nd) / (a.d - b.d);
      return a.mul + (b.mul - a.mul) * t;
    }
  }
  return 1;
}

/**
 * 進行状況に応じたおすすめ属性。上から順に条件を満たす最初のものを表示する。
 * 強制ではなくガイドとしての提示。
 */
const ELEMENT_RECOMMENDATIONS = [
  {
    minWave: 300, id: 'gravity',
    reasons: ['高難度ほど重圧の火力が伸びる', '敵を至近で捌けるなら圧倒的な殲滅力'],
  },
  {
    minWave: 100, id: 'thunder',
    reasons: ['敵数が増えてくるため連鎖攻撃が強力', 'スタンで押し込まれにくくなる'],
  },
  {
    minWave: 0, id: 'fire',
    reasons: ['敵を倒しやすい', '序盤攻略が安定する'],
  },
  // 上位候補を既に解放している場合の予備候補
  {
    minWave: 0, id: 'ice',
    reasons: ['減速と凍結で被弾を減らせる', '安定して長く粘りたい場合に有効'],
  },
  {
    minWave: 0, id: 'economy',
    reasons: ['CashとCoinが大きく増える', '研究やLABの進みを早めたい場合に'],
  },
  {
    minWave: 0, id: 'thunder',
    reasons: ['敵が多いほど連鎖が活きる', 'スタンで足止めできる'],
  },
  {
    minWave: 0, id: 'gravity',
    reasons: ['至近距離で与ダメージが最大2倍', '瀕死の敵を圧壊で即死させられる'],
  },
];

const ELEMENTS = [
  {
    id: 'none', name: 'ニュートラル', icon: '◇', color: '#9fb4c7',
    tagline: '癖のない標準構成',
    desc: '特殊効果はないが、攻撃力とHPが安定して伸びる。',
    levelCost: [2, 4, 7, 10],
    rating: 5, archetype: 'バランス型',
    guide: '攻撃・防御・経済をバランス良く強化。迷ったらまずはこちら。',
    tooltip: {
      merit: ['癖がなく、どの構成にも噛み合う', '解放不要で最初から使える', 'レベルを上げると攻撃とHPが素直に伸びる'],
      demerit: ['特殊効果がないため派手な殲滅力はない', '高Waveでは他属性の伸びに置いていかれやすい'],
      weapons: ['汎用型の究極武器（今後実装）'],
      drones: ['攻撃ドローン／回復ドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    baseParams: { atkBonus: 0.05, hpBonus: 0.05 },
    levelPerks: [
      null,
      { text: '攻撃力ボーナス +40%', k: 'atkBonus', mul: 1.4 },
      { text: 'HPボーナス +40%', k: 'hpBonus', mul: 1.4 },
      { text: '攻撃力ボーナス +40%', k: 'atkBonus', mul: 1.4 },
      { text: 'HPボーナス +40%', k: 'hpBonus', mul: 1.4 },
    ],
    research: [
      { id: 'neuAtk', name: '基幹出力', k: 'atkBonus', per: 0.08,
        maxLevel: 30, baseCost: 60, growth: 1.22, unit: '攻撃力' },
      { id: 'neuHp', name: '基幹装甲', k: 'hpBonus', per: 0.08,
        maxLevel: 30, baseCost: 60, growth: 1.22, unit: 'HP' },
    ],
    stats(s, p, P) {
      s.damageMul += P.atkBonus * p;
      s.hpMul += P.hpBonus * p;
    },
    effectText: (P, p) =>
      'ダメージ +' + (P.atkBonus * p * 100).toFixed(0) + '% / HP +' +
      (P.hpBonus * p * 100).toFixed(0) + '%',
  },
  {
    id: 'fire', name: '炎', icon: '✹', color: '#ff7a3d',
    tagline: '継続ダメージと爆発',
    desc: '命中した敵を燃焼させ、燃焼中の敵を倒すと周囲へ爆発が広がる。',
    levelCost: [2, 4, 7, 10],
    rating: 4, archetype: '火力特化',
    guide: '継続ダメージと爆発で大量の敵を一掃。初心者にも扱いやすい攻撃型。',
    tooltip: {
      merit: ['燃焼が重なるほど雑魚処理が速い', '撃破時の爆発が連鎖して群れを一掃できる', '単純に攻撃力も上がる'],
      demerit: ['単体のボスには燃焼以外の恩恵が薄い', '爆発が起きるまでのラグがある'],
      weapons: ['範囲攻撃系の究極武器（今後実装）'],
      drones: ['攻撃ドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    baseParams: { burnDuration: 3.0, burnDps: 0.35, blastRadius: 70, blastDamage: 0.12 },
    levelPerks: [
      null,
      { text: '燃焼時間 +10%', k: 'burnDuration', mul: 1.10 },
      { text: '燃焼ダメージ +20%', k: 'burnDps', mul: 1.20 },
      { text: '爆発範囲 +20%', k: 'blastRadius', mul: 1.20 },
      { text: '爆発ダメージ +30%', k: 'blastDamage', mul: 1.30 },
    ],
    research: [
      { id: 'fireDur', name: '燃焼持続', k: 'burnDuration', per: 0.05,
        maxLevel: 40, baseCost: 120, growth: 1.24, unit: '燃焼時間' },
      { id: 'fireDps', name: '火力増幅', k: 'burnDps', per: 0.06,
        maxLevel: 50, baseCost: 150, growth: 1.24, unit: '燃焼ダメージ' },
      { id: 'fireRadius', name: '爆風拡張', k: 'blastRadius', per: 0.04,
        maxLevel: 40, baseCost: 180, growth: 1.26, unit: '爆発範囲' },
      { id: 'fireBlast', name: '爆裂弾頭', k: 'blastDamage', per: 0.07,
        maxLevel: 50, baseCost: 220, growth: 1.26, unit: '爆発ダメージ' },
    ],
    stats(s, p) { s.damageMul += 0.08 * p; },
    onHit(game, enemy, dmg, p, P) {
      const dps = dmg * P.burnDps * p;
      if (dps > enemy.burnDps) enemy.burnDps = dps;
      enemy.burnTimer = Math.max(enemy.burnTimer, P.burnDuration);
    },
    onKill(game, enemy, p, P) {
      if (enemy.burnTimer <= 0) return;
      enemy.burnTimer = 0;   // 同じ敵から二重に爆発しないようにする
      game.explode(
        enemy.x, enemy.y,
        P.blastRadius * (0.8 + 0.2 * p),
        enemy.maxHp * P.blastDamage * p,
        '#ff7a3d'
      );
    },
    effectText: (P, p) =>
      '燃焼 ' + (P.burnDps * p * 100).toFixed(0) + '%/秒 × ' +
      P.burnDuration.toFixed(1) + '秒 ・ 爆発 半径' + P.blastRadius.toFixed(0),
  },
  {
    id: 'thunder', name: '雷', icon: '⚡', color: '#ffe14d',
    tagline: '連鎖攻撃とスタン',
    desc: '一定確率で近くの敵へ電撃が連鎖し、当たった敵を短時間動けなくする。',
    levelCost: [2, 5, 8, 12],
    rating: 4, archetype: '連鎖殲滅',
    guide: '攻撃が複数の敵へ連鎖し、スタンで足止めも可能。敵数が多いほど真価を発揮する。',
    tooltip: {
      merit: ['1発で複数の敵を巻き込める', 'スタンでコアへの到達を遅らせられる', 'クリティカル率も上がる'],
      demerit: ['敵が散らばっていると連鎖しにくい', '発生が確率依存で安定しない'],
      weapons: ['多段ヒット系の究極武器（今後実装）'],
      drones: ['デバフドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    baseParams: {
      chainRange: 130, chainCount: 2, chainDamage: 0.5,
      stunDuration: 0.35, chainChance: 0.25,
    },
    levelPerks: [
      null,
      { text: '連鎖距離 +15%', k: 'chainRange', mul: 1.15 },
      { text: '追加連鎖 +1', k: 'chainCount', mul: 1.5 },
      { text: 'スタン時間 +20%', k: 'stunDuration', mul: 1.20 },
      { text: '連鎖ダメージ +30%', k: 'chainDamage', mul: 1.30 },
    ],
    research: [
      { id: 'thnRange', name: '電導範囲', k: 'chainRange', per: 0.04,
        maxLevel: 40, baseCost: 140, growth: 1.24, unit: '連鎖距離' },
      { id: 'thnStun', name: '麻痺電流', k: 'stunDuration', per: 0.05,
        maxLevel: 40, baseCost: 170, growth: 1.25, unit: 'スタン時間' },
      { id: 'thnCount', name: '分岐回路', k: 'chainCount', per: 0.10,
        maxLevel: 20, baseCost: 400, growth: 1.35, unit: '連鎖数' },
      { id: 'thnDamage', name: '高電圧', k: 'chainDamage', per: 0.06,
        maxLevel: 50, baseCost: 200, growth: 1.25, unit: '連鎖ダメージ' },
      { id: 'thnChance', name: '放電頻度', k: 'chainChance', per: 0.04,
        maxLevel: 30, baseCost: 300, growth: 1.30, unit: '連鎖率' },
    ],
    stats(s, p) { s.critChance += 0.05 * p; },
    onHit(game, enemy, dmg, p, P) {
      if (Math.random() > Math.min(P.chainChance * p, 0.9)) return;
      const rSq = P.chainRange * P.chainRange;
      const limit = Math.floor(P.chainCount + p - 1);
      let chained = 0;
      for (let i = 0; i < game.enemies.length && chained < limit; i++) {
        const e = game.enemies[i];
        if (!e || e === enemy || e.hp <= 0) continue;
        const dx = e.x - enemy.x;
        const dy = e.y - enemy.y;
        if (dx * dx + dy * dy > rSq) continue;
        game.damageEnemy(e, dmg * P.chainDamage * p, 0, true);
        e.stunTimer = Math.max(e.stunTimer, P.stunDuration * p);
        game.spawnLightning(enemy.x, enemy.y, e.x, e.y);
        chained++;
      }
      enemy.stunTimer = Math.max(enemy.stunTimer, P.stunDuration * p);
    },
    effectText: (P, p) =>
      (Math.min(P.chainChance * p, 0.9) * 100).toFixed(0) + '%で ' +
      Math.floor(P.chainCount + p - 1) + '体へ連鎖 ・ スタン ' +
      (P.stunDuration * p).toFixed(2) + '秒',
  },
  {
    id: 'ice', name: '氷', icon: '❄', color: '#7fd8ff',
    tagline: '減速と凍結',
    desc: '命中した敵の移動速度を下げ、重ねがけすると完全に凍結させる。',
    levelCost: [2, 4, 7, 10],
    rating: 3, archetype: '安全重視',
    guide: '敵を減速・凍結させて生存率を高める。安定攻略向け。',
    tooltip: {
      merit: ['被弾そのものを減らせる', '凍結中は大ダメージを与えられる', 'クリティカル倍率も上がる'],
      demerit: ['与ダメージが直接は増えない', '効果が出るまで数発当てる必要がある'],
      weapons: ['状態異常強化系の究極武器（今後実装）'],
      drones: ['シールドドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    baseParams: {
      chillPerHit: 0.12, slowMax: 0.8, freezeDuration: 1.2, freezeDamage: 1.0,
    },
    levelPerks: [
      null,
      { text: '減速量 +10%', k: 'slowMax', mul: 1.10 },
      { text: '凍結時間 +15%', k: 'freezeDuration', mul: 1.15 },
      { text: '凍結に必要なヒット数が減少', k: 'chillPerHit', mul: 1.5 },
      { text: '凍結中の被ダメージ +25%', k: 'freezeDamage', mul: 1.25 },
    ],
    research: [
      { id: 'iceSlow', name: '冷却効率', k: 'chillPerHit', per: 0.06,
        maxLevel: 40, baseCost: 150, growth: 1.24, unit: '蓄積速度' },
      { id: 'iceFreeze', name: '凍結持続', k: 'freezeDuration', per: 0.05,
        maxLevel: 40, baseCost: 180, growth: 1.25, unit: '凍結時間' },
      { id: 'iceDepth', name: '絶対零度', k: 'slowMax', per: 0.02,
        maxLevel: 20, baseCost: 350, growth: 1.32, unit: '減速上限' },
      { id: 'iceShatter', name: '砕氷弾', k: 'freezeDamage', per: 0.05,
        maxLevel: 50, baseCost: 250, growth: 1.26, unit: '凍結中ダメージ' },
    ],
    stats(s, p) { s.critMultiplier += 0.15 * p; },
    onHit(game, enemy, dmg, p, P) {
      enemy.chill = Math.min(enemy.chill + P.chillPerHit * p, 1);
      enemy.chillTimer = 2.5;
      enemy.slowMax = Math.min(P.slowMax, 0.92);
      if (enemy.chill >= 1 && enemy.freezeCd <= 0) {
        enemy.freezeCd = 6;
        enemy.stunTimer = Math.max(enemy.stunTimer, P.freezeDuration * p);
        enemy.frozenBonus = P.freezeDamage;
        enemy.chill = 0;
        game.spawnParticles(enemy.x, enemy.y, 10, 120, 0.4, 3, '#7fd8ff');
      }
    },
    effectText: (P, p) =>
      '最大 ' + (Math.min(P.slowMax, 0.92) * 100).toFixed(0) + '% 減速 ・ 凍結 ' +
      (P.freezeDuration * p).toFixed(2) + '秒 ・ 凍結中 ×' + P.freezeDamage.toFixed(2),
  },
  {
    id: 'gravity', name: '重力', icon: '◉', color: '#a561ff',
    tagline: '重圧と圧壊',
    desc: '敵が近づくほど重力が強まり、押し潰されて受けるダメージが増加する。瀕死の敵は圧壊し、近距離での撃破は圧力波を生む。',
    levelCost: [3, 5, 9, 14],
    rating: 5, archetype: 'リスク・リターン型',
    guide: '敵を引き付けるリスクを負う代わりに、至近距離で圧倒的な火力を得る。高難度ほど真価を発揮する上級者向け。',
    tooltip: {
      merit: [
        '敵がプレイヤーへ近づくほど与ダメージが最大2倍に増加',
        '瀕死の敵を重力で圧壊させ即死させる（ボスにも有効）',
        '近距離での撃破が圧力波となり周囲を巻き込む',
      ],
      demerit: [
        '真価を出すには敵を至近距離まで引き付ける必要がある',
        '防御が薄いと押し寄せられて一気に崩れる',
        '遠距離で捌く立ち回りとは噛み合わない',
      ],
      weapons: ['近接・範囲圧殺系の究極武器（今後実装）'],
      drones: ['シールドドローン／攻撃ドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    // pressureScale: 重圧の強さ / executeLine: 圧縮の即死ライン（Lv3で解放）
    // collapseDamage: 崩壊ダメージ（Lv4で解放）/ collapseRange: 崩壊範囲
    // coreEffect: エフェクト強化
    baseParams: {
      pressureScale: 1.0,
      executeLine: 0,
      collapseDamage: 0,
      collapseRange: GRAVITY.collapseRange,
      coreEffect: 1.0,
    },
    levelPerks: [
      null,
      // Lv2: 近距離ダメージ倍率アップ
      { text: '重圧の近距離ダメージ倍率 +15%', k: 'pressureScale', mul: 1.15 },
      // Lv3: 重力圧縮 解放
      { text: '重力圧縮 解放（瀕死の敵を圧壊）', k: 'executeLine', set: GRAVITY.executeNormal },
      // Lv4: 重力崩壊 解放
      { text: '重力崩壊 解放（近距離撃破で圧力波）', k: 'collapseDamage', set: GRAVITY.collapseDamagePct },
      // Lv5: 近距離ダメージ倍率さらにアップ ＋ 崩壊範囲アップ（複合効果）
      {
        text: '重圧の倍率 +20% ・ 重力崩壊の範囲 +40%',
        effects: [
          { k: 'pressureScale', mul: 1.20 },
          { k: 'collapseRange', mul: 1.40 },
        ],
      },
    ],
    research: [
      { id: 'grvPressure', name: 'Gravity Pressure', k: 'pressureScale', per: 0.03,
        maxLevel: 40, baseCost: 200, growth: 1.25, unit: '近距離ダメージ倍率' },
      { id: 'grvCompress', name: 'Gravity Compression', k: 'executeLine', per: 0.04,
        maxLevel: 30, baseCost: 260, growth: 1.27, unit: '即死ライン' },
      { id: 'grvCollapse', name: 'Gravity Collapse', k: 'collapseRange', per: 0.04,
        maxLevel: 40, baseCost: 220, growth: 1.24, unit: '崩壊範囲' },
      { id: 'grvCollapseDmg', name: 'Gravity Collapse Damage', k: 'collapseDamage', per: 0.05,
        maxLevel: 40, baseCost: 240, growth: 1.26, unit: '崩壊ダメージ' },
      { id: 'grvCore', name: 'Gravity Core', k: 'coreEffect', per: 0.03,
        maxLevel: 30, baseCost: 300, growth: 1.28, unit: '重力エフェクト' },
    ],
    stats(s, p, P) {
      // 圧力場を機能させるため射程をわずかに底上げ
      s.range += 15 * p;

      // 重力圧縮の即死ライン（研究で伸長、上限でクランプ）
      const line = Math.min(P.executeLine, GRAVITY.executeNormalCap);
      s.gravExecute = line;
      // ボスの即死ラインは通常ラインの伸びに比例させる
      s.gravBossExecute = line > 0
        ? Math.min(GRAVITY.executeBoss * (line / GRAVITY.executeNormal), GRAVITY.executeBossCap)
        : 0;

      // 重力崩壊
      s.gravCollapseDamage = P.collapseDamage;
      s.gravCollapseRange = P.collapseRange;
      s.gravCore = P.coreEffect;
    },
    // 重圧：プレイヤーに近い敵ほど与ダメージが増える（主砲へ適用）
    damageMul(game, enemy, p, P) {
      const range = game.player.stats.range * GRAVITY.pressureRangeFactor;
      const dx = enemy.x - game.cx;
      const dy = enemy.y - game.cy;
      const nd = Math.min((Math.hypot(dx, dy)) / (range || 1), 1);
      const base = gravityPressureMul(nd);        // 1.0〜2.0
      // pressureScale はボーナス部分（100%を超える分）を拡大する
      return 1 + (base - 1) * P.pressureScale * p;
    },
    // 重力崩壊：プレイヤー付近での撃破時に圧力波を発生させる
    onKill(game, enemy, p, P) {
      if (P.collapseDamage <= 0) return;
      const pdx = enemy.x - game.cx;
      const pdy = enemy.y - game.cy;
      const trig = GRAVITY.collapseTriggerDist;
      if (pdx * pdx + pdy * pdy > trig * trig) return;

      const range = P.collapseRange;
      const rSq = range * range;
      const dmgPct = P.collapseDamage * p;
      game.spawnPressureWave(enemy.x, enemy.y, range);
      for (let i = 0; i < game.enemies.length; i++) {
        const e = game.enemies[i];
        if (!e || e === enemy) continue;
        const dx = e.x - enemy.x;
        const dy = e.y - enemy.y;
        if (dx * dx + dy * dy > rSq) continue;
        game.damageEnemy(e, e.maxHp * dmgPct, 0, false);
      }
    },
    effectText: (P, p) => {
      const peak = (1 + (2.0 - 1) * P.pressureScale * p) * 100;
      const line = Math.min(P.executeLine, GRAVITY.executeNormalCap);
      const parts = ['至近で最大 ' + peak.toFixed(0) + '%'];
      if (line > 0) parts.push('圧壊 HP' + (line * 100).toFixed(0) + '%以下');
      if (P.collapseDamage > 0) {
        parts.push('崩壊 ' + (P.collapseDamage * p * 100).toFixed(0) + '% / 半径' +
          P.collapseRange.toFixed(0));
      }
      return parts.join(' ・ ');
    },
  },
  {
    id: 'economy', name: '経済', icon: '$', color: '#3dff9e',
    tagline: '資源収集特化',
    desc: '戦闘能力は伸びないが、CashとCoinの獲得量が大きく増える。',
    levelCost: [2, 4, 7, 10],
    rating: 2, archetype: '長期育成',
    guide: '戦闘能力は低いがCash・Coin獲得量が増加。育成効率を重視したいプレイヤー向け。',
    tooltip: {
      merit: ['1周回あたりの収入が大きく増える', 'R&DやLABの進みが早くなる', 'Lv5で撃破時にGemを拾える'],
      demerit: ['戦闘力がほぼ伸びず到達Waveは落ちる', '短期的な手応えは薄い'],
      weapons: ['資源獲得系の究極武器（今後実装）'],
      drones: ['採掘ドローン（今後実装）'],
    },
    expTable: ELEMENT_EXP_TABLE,
    baseParams: {
      cashBonus: 0.6, coinBonus: 0.3, bossReward: 1.0, gemOnKill: 0,
    },
    levelPerks: [
      null,
      { text: 'Cash +10%', k: 'cashBonus', mul: 1.10 },
      { text: 'Coin +10%', k: 'coinBonus', mul: 1.10 },
      { text: 'ボス報酬 +20%', k: 'bossReward', mul: 1.20 },
      { text: '撃破時に確率でGem獲得', k: 'gemOnKill', set: 0.00008 },
    ],
    research: [
      { id: 'ecoCash', name: '市場操作', k: 'cashBonus', per: 0.06,
        maxLevel: 50, baseCost: 140, growth: 1.24, unit: 'Cash' },
      { id: 'ecoCoin', name: '通貨供給', k: 'coinBonus', per: 0.06,
        maxLevel: 50, baseCost: 200, growth: 1.26, unit: 'Coin' },
      { id: 'ecoBoss', name: '戦利品鑑定', k: 'bossReward', per: 0.05,
        maxLevel: 40, baseCost: 300, growth: 1.28, unit: 'ボス報酬' },
      { id: 'ecoGem', name: '結晶抽出', k: 'gemOnKill', per: 0.30,
        maxLevel: 25, baseCost: 900, growth: 1.40, unit: 'Gem獲得率' },
    ],
    stats(s, p, P) {
      s.cashBonus += P.cashBonus * p;
      s.coinBonus += P.coinBonus * p;
      s.interest += 0.02 * p;
    },
    onKill(game, enemy, p, P) {
      if (P.gemOnKill > 0 && Math.random() < P.gemOnKill * p) {
        game.addGem(1);
        game.spawnParticles(enemy.x, enemy.y, 8, 140, 0.5, 3, '#ff2d95');
      }
    },
    effectText: (P, p) =>
      'Cash +' + (P.cashBonus * p * 100).toFixed(0) + '% / Coin +' +
      (P.coinBonus * p * 100).toFixed(0) + '%' +
      (P.gemOnKill > 0 ? ' ・ Gem ' + (P.gemOnKill * p * 100).toFixed(3) + '%' : ''),
  },
];

/** 属性のレベルと専用研究を反映した効果値を返す */
function elementParams(el, level, researchLevels) {
  const P = Object.assign({}, el.baseParams);

  // レベル特典（index 1 が Lv2 の特典）
  for (let lv = 2; lv <= level; lv++) {
    const perk = el.levelPerks[lv - 1];
    if (!perk) continue;
    // 1つのレベルで複数のパラメータを変える場合は perk.effects を使う。
    // 単一の場合は従来どおり perk 自身を効果として扱う（後方互換）。
    const effects = perk.effects || [perk];
    for (let j = 0; j < effects.length; j++) {
      const eff = effects[j];
      if (eff.k === undefined) continue;
      if (eff.set !== undefined) P[eff.k] = eff.set;
      else if (eff.mul !== undefined) P[eff.k] *= eff.mul;
    }
  }

  // 属性専用研究
  const levels = researchLevels || {};
  for (let i = 0; i < el.research.length; i++) {
    const r = el.research[i];
    const lv = levels[r.id] || 0;
    if (lv > 0) P[r.k] *= 1 + r.per * lv;
  }
  return P;
}

/** 累計撃破数から属性レベル（1〜5）を求める */
function elementLevelFromExp(el, exp) {
  let lv = 1;
  for (let i = 1; i < el.expTable.length; i++) {
    if (exp >= el.expTable[i]) lv = i + 1;
  }
  return lv;
}

function elementById(id) {
  for (let i = 0; i < ELEMENTS.length; i++) {
    if (ELEMENTS[i].id === id) return ELEMENTS[i];
  }
  return ELEMENTS[0];
}

/* ---------------------------------------------------------
 * モジュール（装備システム）
 * ------------------------------------------------------- */

/**
 * レアリティ。power はモジュール性能の倍率、subs はランダム能力の個数。
 * 上位を足したい場合はこの配列の末尾へ追加する。
 */
const RARITIES = [
  { id: 'common', name: 'Common', color: '#9fb4c7', weight: 6000, power: 1.0, subs: 0 },
  { id: 'rare', name: 'Rare', color: '#4fa8ff', weight: 2500, power: 1.5, subs: 1 },
  { id: 'epic', name: 'Epic', color: '#a561ff', weight: 1000, power: 2.2, subs: 2 },
  { id: 'legend', name: 'Legend', color: '#ffc233', weight: 400, power: 3.2, subs: 3 },
  { id: 'mythic', name: 'Mythic', color: '#ff2d95', weight: 90, power: 4.6, subs: 4 },
  { id: 'unique', name: 'Unique', color: '#3dff9e', weight: 10, power: 6.5, subs: 5 },
];

/** レアリティ id から定義を引く */
function rarityById(id) {
  for (let i = 0; i < RARITIES.length; i++) {
    if (RARITIES[i].id === id) return RARITIES[i];
  }
  return RARITIES[0];
}

function rarityIndex(id) {
  for (let i = 0; i < RARITIES.length; i++) {
    if (RARITIES[i].id === id) return i;
  }
  return 0;
}

/** モジュールの装備枠。種類ごとに1つずつ装備できる */
const MODULE_TYPES = [
  { id: 'attack', label: '攻撃', color: '#ff3b6b' },
  { id: 'defense', label: '防御', color: '#00e5ff' },
  { id: 'economy', label: '経済', color: '#3dff9e' },
  { id: 'special', label: '特殊', color: '#a561ff' },
];

/**
 * モジュールの設計図。ガチャはこの配列から抽選する。
 * fixed は「固定能力」で、power（レアリティ倍率×レベル補正）が乗る。
 */
const MODULE_BLUEPRINTS = [
  /* ---- 攻撃 ---- */
  {
    id: 'mod_barrel', name: '加速砲身', type: 'attack',
    desc: '攻撃力に倍率がかかる',
    fixed(s, p) { s.damageMul += 0.12 * p; },
    fixedText: (p) => 'ダメージ +' + (12 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_coolant', name: '冷却循環器', type: 'attack',
    desc: '攻撃速度が上昇する',
    fixed(s, p) { s.attackInterval = s.attackInterval / (1 + 0.08 * p); },
    fixedText: (p) => '攻撃速度 +' + (8 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_scope', name: '照準演算装置', type: 'attack',
    desc: 'クリティカル率と倍率が上昇する',
    fixed(s, p) { s.critChance += 0.04 * p; s.critMultiplier += 0.12 * p; },
    fixedText: (p) => 'クリ率 +' + (4 * p).toFixed(1) + '% / 倍率 +' + (12 * p).toFixed(0) + '%',
  },

  /* ---- 防御 ---- */
  {
    id: 'mod_plating', name: '積層装甲板', type: 'defense',
    desc: '最大HPに倍率がかかる',
    fixed(s, p) { s.hpMul += 0.15 * p; },
    fixedText: (p) => 'HP +' + (15 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_barrier', name: '障壁発生器', type: 'defense',
    desc: '防御壁の耐久と回復が上昇する',
    fixed(s, p) { s.wallFortification += 0.2 * p; s.wallRegen += 6 * p; },
    fixedText: (p) => '壁HP +' + (20 * p).toFixed(0) + '% / 壁回復 +' + (6 * p).toFixed(0),
  },
  {
    id: 'mod_nanite', name: 'ナノマシン群', type: 'defense',
    desc: 'HPの自動回復と防御力が上昇する',
    fixed(s, p) { s.hpRegen += 3 * p; s.defense += 12 * p; },
    fixedText: (p) => '回復 +' + (3 * p).toFixed(1) + '/s / 防御 +' + (12 * p).toFixed(0),
  },

  /* ---- 経済 ---- */
  {
    id: 'mod_refinery', name: '精錬炉', type: 'economy',
    desc: 'Cash獲得量が増加する',
    fixed(s, p) { s.cashBonus += 0.25 * p; },
    fixedText: (p) => 'Cash +' + (25 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_mint', name: '自動鋳造機', type: 'economy',
    desc: 'Coin獲得量が増加する',
    fixed(s, p) { s.coinBonus += 0.15 * p; },
    fixedText: (p) => 'Coin +' + (15 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_vault', name: '準備金庫', type: 'economy',
    desc: '利息と初期資金が増加する',
    fixed(s, p) { s.interest += 0.015 * p; s.startingCash += 400 * p; },
    fixedText: (p) => '利息 +' + (1.5 * p).toFixed(1) + '% / 初期$' + formatNumber(400 * p),
  },

  /* ---- 特殊 ---- */
  {
    id: 'mod_orbcore', name: '衛星制御核', type: 'special',
    desc: 'オーブの威力と速度が上昇する',
    fixed(s, p) { s.orbDamage += 40 * p; s.orbSpeed += 0.2 * p; },
    fixedText: (p) => 'オーブ威力 +' + formatNumber(40 * p) + ' / 速度 +' + (0.2 * p).toFixed(2),
  },
  {
    id: 'mod_titankiller', name: '巨獣狩猟装置', type: 'special',
    desc: 'ボスへの与ダメージが増加する',
    fixed(s, p) { s.bossDamageMul += 0.2 * p; },
    fixedText: (p) => 'ボス与ダメ +' + (20 * p).toFixed(0) + '%',
  },
  {
    id: 'mod_gravity', name: '重力制御器', type: 'special',
    desc: '敵の移動速度を低下させる',
    fixed(s, p) { s.enemySpeedMul -= Math.min(0.03 * p, 0.25); },
    fixedText: (p) => '敵速度 -' + Math.min(3 * p, 25).toFixed(1) + '%',
  },
];

function blueprintById(id) {
  for (let i = 0; i < MODULE_BLUEPRINTS.length; i++) {
    if (MODULE_BLUEPRINTS[i].id === id) return MODULE_BLUEPRINTS[i];
  }
  return null;
}

/**
 * ランダム能力（サブステータス）。レアリティに応じた個数が付与される。
 * value は roll の範囲で抽選され、レアリティ倍率が乗る。
 */
const MODULE_SUBSTATS = [
  { id: 'sub_dmg', name: 'ダメージ', roll: [3, 8],
    apply(s, v) { s.damageMul += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_hp', name: '最大HP', roll: [4, 10],
    apply(s, v) { s.hpMul += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_aspd', name: '攻撃速度', roll: [2, 6],
    apply(s, v) { s.attackInterval = s.attackInterval / (1 + v / 100); },
    format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_crit', name: 'クリティカル率', roll: [1, 4],
    apply(s, v) { s.critChance += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_critdmg', name: 'クリティカル倍率', roll: [4, 12],
    apply(s, v) { s.critMultiplier += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_range', name: '射程', roll: [4, 12],
    apply(s, v) { s.range += v; }, format: (v) => '+' + v.toFixed(0) },
  { id: 'sub_def', name: '防御力', roll: [5, 15],
    apply(s, v) { s.defense += v; }, format: (v) => '+' + v.toFixed(0) },
  { id: 'sub_cash', name: 'Cash獲得', roll: [5, 15],
    apply(s, v) { s.cashBonus += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_coin', name: 'Coin獲得', roll: [3, 10],
    apply(s, v) { s.coinBonus += v / 100; }, format: (v) => '+' + v.toFixed(1) + '%' },
  { id: 'sub_lifesteal', name: 'HP吸収', roll: [0.2, 0.8],
    apply(s, v) { s.lifesteal += v / 100; }, format: (v) => '+' + v.toFixed(2) + '%' },
];

function substatById(id) {
  for (let i = 0; i < MODULE_SUBSTATS.length; i++) {
    if (MODULE_SUBSTATS[i].id === id) return MODULE_SUBSTATS[i];
  }
  return null;
}

/** モジュールのレベル上限とレベル毎の性能補正 */
const MODULE_MAX_LEVEL = 20;

/** 所持できるモジュールの上限。超過ぶんは自動でシャードへ変換する */
const MODULE_INVENTORY_MAX = 300;
function modulePower(rarity, level) {
  return rarityById(rarity).power * (1 + level * 0.12);
}

/** レベルアップに必要なシャード */
function moduleUpgradeCost(rarity, level) {
  return Math.floor((6 + level * 4) * (1 + rarityIndex(rarity) * 0.6));
}

/** 分解・重複で得られるシャード */
function moduleShardValue(rarity) {
  return [2, 6, 18, 55, 160, 500][rarityIndex(rarity)];
}

/* ---------------------------------------------------------
 * スキン（ガチャ排出の見た目アイテム）
 * ------------------------------------------------------- */

const SKINS = [
  { id: 'skin_default', name: 'スタンダード', rarity: 'common',
    core: '#00e5ff', accent: '#ff2d95', shot: '#5cf0ff' },
  { id: 'skin_ember', name: 'エンバー', rarity: 'rare',
    core: '#ff7a3d', accent: '#ffd23d', shot: '#ffb14d' },
  { id: 'skin_frost', name: 'フロストバイト', rarity: 'epic',
    core: '#7fd8ff', accent: '#ffffff', shot: '#c8f2ff' },
  { id: 'skin_void', name: 'ヴォイド', rarity: 'legend',
    core: '#a561ff', accent: '#ff2d95', shot: '#c79dff' },
  { id: 'skin_solaris', name: 'ソラリス', rarity: 'mythic',
    core: '#ffc233', accent: '#ff5c3d', shot: '#ffe07a' },
  { id: 'skin_singularity', name: 'シンギュラリティ', rarity: 'unique',
    core: '#3dff9e', accent: '#00e5ff', shot: '#9dffd0' },
];

function skinById(id) {
  for (let i = 0; i < SKINS.length; i++) {
    if (SKINS[i].id === id) return SKINS[i];
  }
  return SKINS[0];
}

/* ---------------------------------------------------------
 * ガチャ
 * ------------------------------------------------------- */

const GACHA_SINGLE_COST = 100;
const GACHA_MULTI_COUNT = 10;
const GACHA_MULTI_COST = 900;

/**
 * 排出内容の種別。kind を増やせば新しい排出物を足せる。
 * weight は種別間の比率。
 */
const GACHA_KINDS = [
  { kind: 'module', weight: 88 },
  { kind: 'skin', weight: 12 },
];

/**
 * 実績。check(ctx) が true を返した時点で解除され、報酬が支払われる。
 * ctx は Game が組み立てた統計スナップショット。
 */
const ACHIEVEMENTS = [
  { id: 'firstBlood', name: '初陣', desc: '敵を1体撃破する',
    coin: 1, gem: 0, check: (c) => c.totalKills >= 1 },
  { id: 'wave5', name: '前哨戦', desc: 'Wave 5 に到達する',
    coin: 3, gem: 0, check: (c) => c.bestWave >= 5 },
  { id: 'wave10', name: '防衛線', desc: 'Wave 10 に到達する',
    coin: 6, gem: 0, frag: 1, check: (c) => c.bestWave >= 10 },
  { id: 'wave25', name: '要塞', desc: 'Wave 25 に到達する',
    coin: 15, gem: 1, frag: 1, check: (c) => c.bestWave >= 25 },
  { id: 'wave50', name: '不落', desc: 'Wave 50 に到達する',
    coin: 40, gem: 2, frag: 2, check: (c) => c.bestWave >= 50 },
  { id: 'wave100', name: '無限回廊', desc: 'Wave 100 に到達する',
    coin: 120, gem: 5, frag: 3, check: (c) => c.bestWave >= 100 },
  { id: 'kill100', name: '掃討', desc: '累計100体を撃破する',
    coin: 5, gem: 0, check: (c) => c.totalKills >= 100 },
  { id: 'kill1000', name: '殲滅者', desc: '累計1000体を撃破する',
    coin: 20, gem: 1, frag: 1, check: (c) => c.totalKills >= 1000 },
  { id: 'kill10000', name: '絶滅', desc: '累計10000体を撃破する',
    coin: 100, gem: 4, frag: 3, check: (c) => c.totalKills >= 10000 },
  { id: 'bossFirst', name: '巨人狩り', desc: 'ボスを初めて撃破する',
    coin: 30, gem: 2, frag: 2, check: (c) => c.bossKills >= 1 },
  { id: 'boss10', name: '討伐隊', desc: 'ボスを10体撃破する',
    coin: 150, gem: 6, frag: 4, check: (c) => c.bossKills >= 10 },
  { id: 'rich', name: '軍需産業', desc: '一度の周回で $100K を所持する',
    coin: 10, gem: 0, check: (c) => c.maxCash >= 100000 },
  { id: 'richer', name: '経済制圧', desc: '一度の周回で $10M を所持する',
    coin: 50, gem: 2, check: (c) => c.maxCash >= 10000000 },
  { id: 'upgrade100', name: '改造狂', desc: '強化の合計レベルを100にする',
    coin: 12, gem: 0, check: (c) => c.upgradeLevels >= 100 },
  { id: 'upgrade1000', name: '過剰武装', desc: '強化の合計レベルを1000にする',
    coin: 60, gem: 3, check: (c) => c.upgradeLevels >= 1000 },
  { id: 'codexAll', name: '観測完了', desc: '全ての敵性体を図鑑に記録する',
    coin: 45, gem: 3, frag: 2,
    check: (c) => c.discoveredCount >= ENEMY_TYPES.filter((t) => !t.hidden).length },
  { id: 'research10', name: '研究者', desc: '研究の合計レベルを10にする',
    coin: 8, gem: 0, check: (c) => c.researchLevels >= 10 },
  { id: 'research100', name: '技術特異点', desc: '研究の合計レベルを100にする',
    coin: 80, gem: 4, frag: 3, check: (c) => c.researchLevels >= 100 },
  { id: 'runs10', name: '不屈', desc: '10回プレイする',
    coin: 10, gem: 0, check: (c) => c.totalRuns >= 10 },
  { id: 'wallMaster', name: '鉄壁', desc: '防御壁を展開した状態でWave20をクリア',
    coin: 25, gem: 1, check: (c) => c.bestWaveWithWall >= 20 },
  { id: 'firstPull', name: '初回排出', desc: 'ガチャを1回引く',
    coin: 5, gem: 0, check: (c) => c.gachaPulls >= 1 },
  { id: 'pull100', name: '収集家', desc: 'ガチャを100回引く',
    coin: 60, gem: 3, check: (c) => c.gachaPulls >= 100 },
  { id: 'fullEquip', name: '完全装備', desc: '4種すべてのモジュールを装備する',
    coin: 30, gem: 2, check: (c) => c.equippedCount >= MODULE_TYPES.length },
  { id: 'legendModule', name: '伝説の設計', desc: 'Legend以上のモジュールを入手する',
    coin: 50, gem: 3, frag: 2, check: (c) => c.bestModuleRarity >= 3 },
  { id: 'moduleMax', name: '限界突破', desc: 'モジュールを +20 まで強化する',
    coin: 80, gem: 4, frag: 3, check: (c) => c.bestModuleLevel >= MODULE_MAX_LEVEL },
];

const SHOP_CATEGORIES = [
  { id: 'attack', label: '攻撃' },
  { id: 'defense', label: '防御' },
  { id: 'utility', label: '補助' },
  { id: 'special', label: '特殊' },
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

/** 重み付き抽選の共通処理 */
function weightedPick(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].weight;
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= list[i].weight;
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/** レアリティを抽選する。minRarity を指定すると下限を保証する */
function rollRarity(minRarityIndex) {
  const pool = minRarityIndex
    ? RARITIES.slice(minRarityIndex)
    : RARITIES;
  return weightedPick(pool);
}

let _moduleUid = 1;
function nextModuleUid() {
  return 'm' + (Date.now().toString(36)) + '_' + (_moduleUid++);
}

/** モジュールを1つ生成する */
function createModule(blueprint, rarity) {
  const rar = rarityById(rarity);
  const subs = [];
  const pool = MODULE_SUBSTATS.slice();
  for (let i = 0; i < rar.subs && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const def = pool.splice(idx, 1)[0];
    const [lo, hi] = def.roll;
    const value = (lo + Math.random() * (hi - lo)) * (1 + rarityIndex(rarity) * 0.25);
    subs.push({ id: def.id, value: Math.round(value * 100) / 100 });
  }
  return {
    uid: nextModuleUid(),
    bp: blueprint.id,
    rarity: rarity,
    level: 0,
    subs: subs,
  };
}

/** BASE_STATS へ永続研究とLAB研究の効果を適用した値を返す（周回開始時の土台） */
function computeResearchStats(equippedModules, elementId, elementState) {
  const s = Object.assign({}, BASE_STATS);
  for (let i = 0; i < RESEARCH.length; i++) {
    const r = RESEARCH[i];
    if (r.level > 0) r.effect(s, r.level);
  }
  for (let i = 0; i < LAB_RESEARCH.length; i++) {
    const r = LAB_RESEARCH[i];
    if (r.level > 0) r.effect(s, r.level);
  }
  // 装備中モジュールの固定能力とランダム能力
  if (equippedModules) {
    for (let i = 0; i < equippedModules.length; i++) {
      applyModuleToStats(s, equippedModules[i]);
    }
  }
  // 属性コアの常時補正（elementPower の確定後に適用する）
  if (elementId) {
    const el = elementById(elementId);
    if (el.stats) {
      const state = elementState || { level: 1, research: {} };
      const P = elementParams(el, state.level, state.research);
      el.stats(s, s.elementPower, P);
    }
  }
  return s;
}

/** モジュール1つぶんの効果をステータスへ適用する */
function applyModuleToStats(s, mod) {
  if (!mod) return;
  const bp = blueprintById(mod.bp);
  if (!bp) return;
  const power = modulePower(mod.rarity, mod.level);
  bp.fixed(s, power);
  for (let i = 0; i < mod.subs.length; i++) {
    const def = substatById(mod.subs[i].id);
    if (def) def.apply(s, mod.subs[i].value);
  }
}

/** LAB研究の着手費用（Coin） */
function labCostAt(r, level) {
  return Math.floor(r.baseCost * Math.pow(r.costGrowth, level));
}

/** LAB研究の所要時間（秒）。上限を超えないようクランプする */
function labDurationAt(r, level) {
  const raw = r.baseDuration * Math.pow(r.durationGrowth, level);
  return Math.floor(Math.min(raw, CONFIG.LAB_MAX_DURATION));
}

/** 秒数を「1時間 23分」形式へ整形 */
function formatDuration(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (d > 0) return d + '日 ' + h + '時間';
  if (h > 0) return h + '時間 ' + m + '分';
  if (m > 0) return m + '分 ' + ss + '秒';
  return ss + '秒';
}

/** 残り時間を即時完了するのに必要なGem */
function labSpeedupGemCost(remainingSec) {
  return Math.max(1, Math.ceil(remainingSec / LAB_SPEEDUP_SECONDS_PER_GEM));
}

/** 到達Waveに対して解放済みのTierかどうか */
function isTierUnlocked(tier, bestWave) {
  return bestWave >= tierRequiredWave(tier);
}

/**
 * 項目の解放に必要なWave。
 * unlockWave が個別指定されていればTierより優先する。
 */
function requiredWaveOf(item) {
  return item.unlockWave !== undefined
    ? item.unlockWave
    : tierRequiredWave(item.tier);
}

/** 配列内のレベル合計（実績判定に使用） */
function totalLevels(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].level;
  return sum;
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
  release(obj) {
    // 削除インデックスのズレ等で undefined が混ざるとプールが壊れるため弾く
    if (!obj) return;
    this._free.push(obj);
  }
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
 * 3.5 セーブ / ロード（localStorage）
 * ======================================================= */

const SAVE_KEY = 'icd_save_v1';
const GAME_VERSION = 'Ver 0.9.0';   // Ver1.0 リリースまでの開発版表記

/**
 * 永続データの保存・復元。
 * プライベートブラウズ等で localStorage が使えない環境でも
 * 例外を握りつぶしてメモリ上だけで動作を継続する。
 */
class SaveManager {
  constructor() {
    this.available = this.probe();
    this.saveTimer = 0;
    this.dirty = false;
  }

  probe() {
    try {
      const k = '__icd_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 初期値（セーブが無い場合や壊れている場合に使う） */
  static defaultMeta() {
    return {
      version: 1,
      coin: 0,
      gem: 0,
      research: {},
      achievements: {},
      codexKills: {},
      discovered: [],
      bestWave: 0,
      bestWaveWithWall: 0,
      totalKills: 0,
      bossKills: 0,
      totalRuns: 0,
      maxCash: 0,
      playTime: 0,
      soundOn: true,
      selectedStartWave: 1,
      devMode: false,           // 開発者メニューの表示
      unlockedTiers: {},        // 解放演出を出し終えたTier
      favorites: {},            // ショップのお気に入り
      gameSpeed: 1,             // 選択中のゲームスピード
      lastExit: 0,              // 最後にゲームを離れた時刻(ms)
      pendingCash: 0,           // オフライン報酬のCash（次周回の開始資金へ加算）
      labLevels: {},            // LAB研究の到達レベル
      labJobs: [],              // 進行中の研究 [{id, level, endsAt}]
      labSlots: 1,              // 研究スロット数
      gemMilestones: {},        // 受取済みの高Wave到達報酬
      adDate: '',               // 広告視聴日（日付が変わればリセット）
      adCount: 0,               // その日の視聴回数
      modules: [],              // 所持モジュール
      equipped: {},             // 種類ID → モジュールuid
      shards: 0,                // モジュール強化素材
      skins: ['skin_default'],  // 所持スキン
      activeSkin: 'skin_default',
      gachaPulls: 0,            // ガチャ回数（実績・演出用）
      activeElement: 'none',    // 使用中の属性コア
      pendingElement: 'none',   // 次の周回から使う属性コア
      elementsUnlocked: { none: true },  // 解放済みの属性
      elementExp: {},           // 属性ID → 累計撃破数
      elementLevel: {},         // 属性ID → 確定済みレベル（1〜5）
      elementResearch: {},      // 属性研究ID → レベル
      fragments: 0,             // Core Fragment（属性専用資源）
      elementMigrated: false,   // 旧Wave解放方式からの移行済みフラグ
      // --- Phase 5-A②: 表示・UI設定（既存セーブは既定値で補完される） ---
      zoom: 1,                  // カメラ表示倍率（0.7〜1.2）
      showDamage: true,         // ダメージ数字の表示
      showEnemyHp: true,        // 敵HPバーの表示
      fxQuality: 'high',        // エフェクト品質 high|med|low
      renderScale: 'high',      // 画質（解像度）high|med|low
      bgmOn: true,              // BGM
      vibrationOn: true,        // 振動（対応端末のみ）
      showFps: false,           // FPS表示
    };
  }

  load() {
    const base = SaveManager.defaultMeta();
    if (!this.available) return base;
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return base;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return base;
      // 既知のキーだけを取り込む（将来のバージョン差異に強くする）
      for (const key of Object.keys(base)) {
        if (data[key] !== undefined && typeof data[key] === typeof base[key]) {
          base[key] = data[key];
        }
      }
      if (!Array.isArray(base.discovered)) base.discovered = [];
      return base;
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました', e);
      return base;
    }
  }

  save(meta) {
    if (!this.available) return false;
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(meta));
      return true;
    } catch (e) {
      console.warn('セーブに失敗しました', e);
      return false;
    }
  }

  clear() {
    if (!this.available) return;
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  }
}

/* =========================================================
 * 4. サウンド（Web Audio・ライブラリ不使用）
 * ======================================================= */

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;      // SE（効果音）
    this.bgmEnabled = true;   // BGM
    this.bgmHigh = false;     // BGMの強度（ボス戦などで上げる）
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
      // BGMはSEマスターとは独立に出力へ繋ぎ、個別にON/OFFできるようにする
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = this._bgmLevel();
      this.bgmGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _bgmLevel() {
    if (!this.bgmEnabled) return 0;
    return this.bgmHigh ? 0.24 : 0.16;
  }

  _applyBgmGain() {
    if (this.bgmGain) this.bgmGain.gain.value = this._bgmLevel();
  }

  setBgmEnabled(on) {
    this.bgmEnabled = on;
    this._applyBgmGain();
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
  achievement() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // 明るい上昇アルペジオ
    this._tone(660, t, 0.10, 'triangle', 0.07);
    this._tone(880, t + 0.09, 0.10, 'triangle', 0.07);
    this._tone(1320, t + 0.18, 0.22, 'triangle', 0.07);
  }
  coreUnlock() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // 荘厳な和音（新コア解放）
    const chord = [262, 330, 392, 523];
    for (let i = 0; i < chord.length; i++) {
      this._tone(chord[i], t, 1.2, 'triangle', 0.06);
      this._tone(chord[i] * 2, t + 0.35, 0.9, 'sine', 0.04);
    }
    this._noise(t + 0.3, 0.9, 0.07, 6000);
    this._tone(1568, t + 0.6, 0.7, 'triangle', 0.06);
  }
  elementLevelUp() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < notes.length; i++) {
      this._tone(notes[i], t + i * 0.06, 0.2, 'triangle', 0.06);
    }
  }
  superOverclock() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(220, t, 0.9, 'sawtooth', 0.11, 3520);
    this._tone(330, t + 0.1, 0.8, 'square', 0.08, 2640);
    this._tone(110, t, 1.0, 'sine', 0.12, 55);
    this._noise(t, 0.6, 0.1, 7000);
  }
  overclock() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(440, t, 0.5, 'sawtooth', 0.09, 1760);
    this._tone(880, t + 0.08, 0.4, 'square', 0.06, 1320);
    this._noise(t, 0.35, 0.08, 5000);
  }
  overheat() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(660, t, 0.5, 'sawtooth', 0.08, 130);
    this._noise(t, 0.4, 0.06, 700);
  }
  gachaCommon() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(520, t, 0.06, 'triangle', 0.05);
    this._tone(700, t + 0.05, 0.08, 'triangle', 0.04);
  }
  /** tier が高いほど派手にする */
  gachaRare(tier) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319, 1568];
    const n = Math.min(3 + tier, notes.length);
    for (let i = 0; i < n; i++) {
      this._tone(notes[i], t + i * 0.07, 0.18, 'triangle', 0.07);
    }
    this._noise(t + n * 0.07, 0.5, 0.07, 4000);
    if (tier >= 4) this._tone(90, t, 0.8, 'sine', 0.1, 45);
  }
  unlockTier() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // 華やかな上昇音（新Tier解放の合図）
    this._tone(523, t, 0.12, 'square', 0.06);
    this._tone(659, t + 0.10, 0.12, 'square', 0.06);
    this._tone(784, t + 0.20, 0.12, 'square', 0.06);
    this._tone(1047, t + 0.30, 0.35, 'triangle', 0.08);
    this._noise(t + 0.30, 0.4, 0.06, 3000);
  }
  research() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(440, t, 0.09, 'sine', 0.07);
    this._tone(660, t + 0.08, 0.09, 'sine', 0.07);
    this._tone(990, t + 0.16, 0.18, 'sine', 0.06);
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
    this.bgmHigh = high;
    this._applyBgmGain();
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
    // 属性コアによる状態異常
    this.burnTimer = 0;      // 燃焼の残り時間
    this.burnDps = 0;        // 燃焼の毎秒ダメージ
    this.stunTimer = 0;      // 行動不能の残り時間
    this.chill = 0;          // 冷却の蓄積（0〜1）
    this.chillTimer = 0;
    this.freezeCd = 0;       // 凍結の再発クールダウン
    this.slowMax = 0.8;      // 減速の上限（氷属性が書き換える）
    this.frozenBonus = 1;    // 凍結中の被ダメージ倍率
    // 特殊敵・ボス用の状態
    this.special = null;     // 特殊挙動の定義（type.special）
    this.healTimer = 0;      // メディックの回復間隔
    this.warpTimer = 0;      // ブリンカーのテレポート間隔
    this.knockbackImmune = false;
    this.bossPatterns = null;
    this.bossPatternTimers = null;
    this.bossTelegraph = 0;  // 予兆の残り時間
    this.bossTelegraphColor = '#fff';
    this.bossShieldTimer = 0;
    this.moveAngle = 0;      // 進行方向（シールド判定用）
  }
  init(type, wave, x, y, speedMul) {
    this.type = type;
    this.x = x; this.y = y;
    this.maxHp = type.baseHp * WAVE_RULES.hpMul(wave);
    this.hp = this.maxHp;
    this.atk = type.baseAtk * WAVE_RULES.atkMul(wave);
    this.speed =
      type.baseSpeed * WAVE_RULES.speedMul(wave) * (speedMul === undefined ? 1 : speedMul);
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
    this.burnTimer = 0;
    this.burnDps = 0;
    this.stunTimer = 0;
    this.chill = 0;
    this.chillTimer = 0;
    this.freezeCd = 0;
    this.slowMax = 0.8;
    this.frozenBonus = 1;

    this.special = type.special || null;
    this.healTimer = this.special && this.special.interval ? this.special.interval : 0;
    this.warpTimer = this.special && this.special.interval ? this.special.interval : 0;
    this.knockbackImmune = !!(this.special && this.special.knockbackImmune);
    this.bossShieldTimer = 0;
    this.bossTelegraph = 0;
    this.moveAngle = 0;

    // ボスの行動パターンを初期化
    if (type.boss) {
      this.bossPatterns = null;      // Game 側で設定する
      this.bossPatternTimers = null;
    }
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
    if (type.behavior === 'ranged') {
      // 反撃不能な位置で膠着しないための保険。
      // 停止できるのは「プレイヤーの射程内」に入っている場合のみとし、
      // それより外なら stopDistance に達していても前進を続ける。
      const counterRange = game.player.stats.range - 12;
      if (dist <= type.stopDistance && dist <= counterRange) moving = false;

      if (dist <= type.stopDistance) {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = type.fireInterval;
          game.spawnEnemyProjectile(this);
        }
      }
    }

    // スタン中は停止、冷却中は減速（最大80%まで）
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      moving = false;
    }
    const cap = this.slowMax || 0.8;
    const slow = this.chillTimer > 0 ? 1 - Math.min(this.chill * cap, cap) : 1;

    if (moving) {
      this.x += (dx / dist) * this.speed * slow * dt;
      this.y += (dy / dist) * this.speed * slow * dt;
      this.moveAngle = Math.atan2(dy, dx);
    }

    // 特殊挙動（データ駆動。special.type ごとに専用処理を呼ぶ）
    if (this.special) this.updateSpecial(dt, game, dist);
    if (this.isBoss && this.bossPatterns) this.updateBoss(dt, game, dist);

    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.spawnAnim > 0) this.spawnAnim -= dt;
    if (this.wallContactCd > 0) this.wallContactCd -= dt;
    if (this.armorBreakTimer > 0) {
      this.armorBreakTimer -= dt;
      if (this.armorBreakTimer <= 0) this.dmgTakenMul = 1;
    }
    if (this.chillTimer > 0) {
      this.chillTimer -= dt;
      if (this.chillTimer <= 0) this.chill = 0;
    }
    if (this.freezeCd > 0) this.freezeCd -= dt;

    if (this.bossShieldTimer > 0) this.bossShieldTimer -= dt;

    this.wobble += dt * 4;
    this.rotation += dt * (this.isBoss ? 0.4 : 1.2);
    return dist;
  }

  /** 特殊敵の毎フレーム処理 */
  updateSpecial(dt, game, dist) {
    const sp = this.special;

    if (sp.type === 'healer') {
      // 周囲の味方を回復する
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = sp.interval;
        const rSq = sp.radius * sp.radius;
        for (let i = 0; i < game.enemies.length; i++) {
          const e = game.enemies[i];
          if (!e || e === this || e.hp >= e.maxHp) continue;
          const ex = e.x - this.x;
          const ey = e.y - this.y;
          if (ex * ex + ey * ey > rSq) continue;
          e.hp = Math.min(e.hp + e.maxHp * sp.healPct, e.maxHp);
          if (Math.random() < 0.5) {
            game.spawnParticles(e.x, e.y, 1, 30, 0.3, 2, '#3dff9e');
          }
        }
      }
    } else if (sp.type === 'warper') {
      // 一定間隔でコア方向へテレポート
      this.warpTimer -= dt;
      if (this.warpTimer <= 0 && dist > sp.minDist) {
        this.warpTimer = sp.interval;
        const jump = Math.min(sp.distance, dist - sp.minDist);
        const ang = Math.atan2(game.cy - this.y, game.cx - this.x);
        game.spawnParticles(this.x, this.y, 8, 120, 0.4, 3, '#c77dff');
        this.x += Math.cos(ang) * jump;
        this.y += Math.sin(ang) * jump;
        game.spawnParticles(this.x, this.y, 8, 120, 0.4, 3, '#c77dff');
      }
    }
    // shield / brute / bomber / splitter / leech は
    // ダメージ処理側（Game）で参照するのでここでは何もしない
  }

  /** シールダーの被ダメージ軽減率（正面から当たったときのみ） */
  shieldReductionFor(px, py) {
    if (!this.special || this.special.type !== 'shield') return 0;
    if (this.stunTimer > 0) return 0;   // スタン中は無防備
    // 弾の飛来方向とシールドの向き（進行方向）を比較する
    const incoming = Math.atan2(py - this.y, px - this.x);
    let diff = Math.abs(incoming - this.moveAngle);
    while (diff > Math.PI) diff = TAU - diff;
    // 正面（進行方向＝コア方向）から来た弾を防ぐ
    return diff < this.special.angle ? this.special.reduction : 0;
  }

  /** ボスの行動パターン処理 */
  updateBoss(dt, game, dist) {
    for (let i = 0; i < this.bossPatterns.length; i++) {
      const pat = this.bossPatterns[i];
      this.bossPatternTimers[i] -= dt;

      // 予兆フェーズ突入
      if (this.bossPatternTimers[i] <= pat.telegraph && this.bossTelegraph <= 0 &&
          this.bossPatternTimers[i] > 0 && !this._telegraphing) {
        this._telegraphing = pat;
        this.bossTelegraph = pat.telegraph;
        this.bossTelegraphColor = pat.color;
      }

      if (this.bossPatternTimers[i] <= 0) {
        this.bossPatternTimers[i] = pat.interval;
        this._telegraphing = null;
        pat.onFire(game, this);
      }
    }
    if (this.bossTelegraph > 0) this.bossTelegraph -= dt;
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
    this.isLaser = false;
    this.radius = 5;
  }
  /** 目標座標へ向かう弾（遠距離敵の通常弾） */
  init(x, y, cx, cy, damage, color) {
    this.x = x; this.y = y;
    this.damage = damage;
    this.color = color || '#a561ff';
    this.life = 6;
    this.isLaser = false;
    this.radius = 5;
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * CONFIG.ENEMY_PROJECTILE_SPEED;
    this.vy = (dy / d) * CONFIG.ENEMY_PROJECTILE_SPEED;
  }
  /** 速度ベクトルを直接指定する弾（ボスAI用） */
  initVel(x, y, vx, vy, damage, color) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.color = color || '#ff2d95';
    this.life = 6;
    this.isLaser = false;
    this.radius = 5;
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

    // オーバークロック（熱）
    this.heat = 0;
    this.heatState = 'normal';   // 'normal' | 'overclock' | 'overheat'
    this.heatStateTimer = 0;

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

    // 永続研究・LAB・装備モジュールを適用した値を土台とし、
    // その上に周回内アップグレードを乗せる
    const s = computeResearchStats(
      this.game.equippedModules(),
      this.game.meta ? this.game.meta.activeElement : 'none',
      this.game.elementState ? this.game.elementState() : null
    );
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      if (u.level > 0) u.effect(s, u.level);
    }
    // 倍率系は全ての加算が終わったあとに適用する
    s.damage *= s.damageMul;
    s.maxHp *= s.hpMul;
    if (s.enemySpeedMul < 0.1) s.enemySpeedMul = 0.1;
    this.stats = s;
    if (this.game.refreshElementParams) this.game.refreshElementParams();

    const hpGain = s.maxHp - prevMaxHp;
    if (hpGain > 0) this.hp += hpGain;
    if (this.hp > s.maxHp) this.hp = s.maxHp;

    const wallGain = this.maxWallHp - prevMaxWall;
    if (wallGain > 0) this.wallHp += wallGain;
    if (this.wallHp > this.maxWallHp) this.wallHp = this.maxWallHp;
  }

  /** 熱による現在の補正値をまとめて返す */
  heatBonus() {
    const s = this.stats;
    if (this.heatState === 'super') {
      // SUPER OVERCLOCK: Mastery Lv5 で解放される最上位状態
      const m = 1 + s.masteryPowerMul;
      return { aspd: 3.4 * m, dmg: 3.2 * m, crit: 0.45 * s.heatBonusMul };
    }
    if (this.heatState === 'overclock') {
      const m = 1 + s.masteryPowerMul;
      return { aspd: 2.2 * m, dmg: 1.9 * m, crit: 0.25 * s.heatBonusMul };
    }
    if (this.heatState === 'overheat') {
      return { aspd: 0.55, dmg: 0.7, crit: 0 };
    }
    // 通常時は熱の割合に比例して緩やかに上昇する
    const r = this.heat / CONFIG.HEAT_MAX;
    const m = s.heatBonusMul;
    return {
      aspd: 1 + r * 0.55 * m,
      dmg: 1 + r * 0.40 * m,
      crit: r * 0.12 * m,
    };
  }

  /** 発熱と状態遷移 */
  updateHeat(dt) {
    const s = this.stats;

    if (this.heatState === 'overclock' || this.heatState === 'super') {
      this.heatStateTimer -= dt;
      this.heat = CONFIG.HEAT_MAX;
      if (this.heatStateTimer <= 0) {
        this.heatState = 'overheat';
        this.heatStateTimer = Math.max(
          CONFIG.OVERHEAT_DURATION - s.overheatReduction, 0.8
        );
        this.heat = 0;
        this.game.onOverheatStart();
      }
      return;
    }

    if (this.heatState === 'overheat') {
      this.heatStateTimer -= dt;
      if (this.heatStateTimer <= 0) {
        this.heatState = 'normal';
        this.game.onOverheatEnd();
      }
      return;
    }

    // 通常時は自然冷却
    if (this.heat > 0) {
      this.heat = Math.max(this.heat - CONFIG.HEAT_DECAY * dt, 0);
    }
  }

  /** 攻撃時の発熱。100%に達したらオーバークロックへ移行する */
  addHeat(shots) {
    if (this.heatState !== 'normal') return;
    const s = this.stats;
    this.heat += CONFIG.HEAT_PER_SHOT * shots * s.heatGainMul;
    if (this.heat < CONFIG.HEAT_MAX) return;

    this.heat = CONFIG.HEAT_MAX;
    // Mastery Lv5 到達で SUPER OVERCLOCK へ進化する
    this.heatState = s.superOverclock ? 'super' : 'overclock';
    this.heatStateTimer = CONFIG.OVERCLOCK_DURATION + s.overclockDuration;
    this.game.onOverclockStart(this.heatState === 'super');
  }

  update(dt) {
    const s = this.stats;
    this.updateHeat(dt);
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
        this.attackCooldown = s.attackInterval * rate / this.heatBonus().aspd;
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

    // Omni Strike: 射程内の敵すべてへ同時攻撃
    if (s.omniStrikeChance > 0 && Math.random() < s.omniStrikeChance) {
      const all = this.findNearestTargets(64);
      for (let i = 0; i < all.length; i++) this.fireAt(all[i]);
      this.addHeat(all.length);
      this.game.flashScreen(0.1, '#8df3ff');
      this.game.sfx.laser();
      return true;
    }

    for (let i = 0; i < targets.length; i++) this.fireAt(targets[i]);
    this.addHeat(targets.length);
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

    const heat = this.heatBonus();
    let critTier = 0;
    let dmg = s.damage * heat.dmg;
    if (Math.random() < s.critChance + heat.crit) {
      critTier = 1;
      dmg *= s.critMultiplier;
      g.runCrits = (g.runCrits || 0) + 1;
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
    e.init(type, this.wave, pt.x, pt.y, g.player.stats.enemySpeedMul);
    if (Math.random() < g.player.stats.enemyHpSkip) e.hp *= 0.5;
    g.enemies.push(e);
    g.discoverEnemy(type.id);
  }

  spawnBoss() {
    const g = this.game;
    const type = ENEMY_TYPES.find((t) => t.boss);
    const pt = this.randomSpawnPoint(g._spawnPt);

    const e = g.enemyPool.acquire();
    e.init(type, this.wave, pt.x, pt.y, g.player.stats.enemySpeedMul);
    g.setupBoss(e);   // 行動パターンを設定
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
    this.searchQuery = '';
    this.blinkTier = null;
    this._blinkTimer = null;

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

    const search = document.getElementById('shop-search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.buildList();
    });
    document.getElementById('btn-search-clear')
      .addEventListener('click', () => {
        search.value = '';
        this.searchQuery = '';
        this.buildList();
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
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.refresh(true);
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  /** 検索・お気に入り・解放状態を考慮した表示順のリストを返す */
  visibleUpgrades() {
    const g = this.game;
    const query = this.searchQuery;
    const list = [];

    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      if (u.category !== this.activeCategory) continue;

      const unlocked = g.isUnlocked(u);
      // 未解放項目は名前を伏せるため、検索対象から外す
      if (query) {
        if (!unlocked) continue;
        const hay = (u.name + ' ' + u.description).toLowerCase();
        if (hay.indexOf(query) === -1) continue;
      }
      list.push(u);
    }

    const fav = g.meta.favorites;
    list.sort((a, b) => {
      const fa = fav[a.id] ? 0 : 1;
      const fb = fav[b.id] ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const wa = requiredWaveOf(a);
      const wb = requiredWaveOf(b);
      if (wa !== wb) return wa - wb;
      return UPGRADES.indexOf(a) - UPGRADES.indexOf(b);
    });
    return list;
  }

  buildList() {
    const g = this.game;
    this.listEl.textContent = '';
    this.itemEls.clear();

    const list = this.visibleUpgrades();

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty';
      empty.textContent = '該当する強化がありません';
      this.listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const unlocked = g.isUnlocked(u);

      const root = document.createElement('div');
      root.className = 'shop-item' + (unlocked ? '' : ' locked');

      // ---- お気に入り ----
      const star = document.createElement('button');
      star.className = 'fav-btn' + (g.meta.favorites[u.id] ? ' on' : '');
      star.textContent = g.meta.favorites[u.id] ? '★' : '☆';
      if (unlocked) {
        star.addEventListener('click', () => this.toggleFavorite(u));
      } else {
        star.classList.add('hidden-el');
      }

      const info = document.createElement('div');
      info.className = 'shop-item-info';

      const top = document.createElement('div');
      top.className = 'shop-item-top';
      const name = document.createElement('span');
      name.className = 'shop-item-name';
      name.textContent = unlocked ? u.name : '？？？';
      const level = document.createElement('span');
      level.className = 'shop-item-level';
      const badge = document.createElement('span');
      badge.className = 'reco-badge';
      badge.textContent = 'おすすめ';
      top.appendChild(name);
      top.appendChild(level);
      top.appendChild(badge);

      const desc = document.createElement('div');
      desc.className = 'shop-item-desc';
      desc.textContent = unlocked
        ? u.description
        : 'WAVE ' + requiredWaveOf(u) + ' で解放';

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
      if (unlocked) btn.addEventListener('click', () => this.buy(u));

      root.appendChild(star);
      root.appendChild(info);
      root.appendChild(btn);
      this.listEl.appendChild(root);

      this.itemEls.set(u.id, {
        root, level, value, btn, count, cost, badge, star, unlocked,
      });
    }
    this.refresh(true);

    // 解放直後のTierは点滅させて気付けるようにする
    if (this.blinkTier !== null) {
      this.itemEls.forEach((els, id) => {
        const u = UPGRADES.find((x) => x.id === id);
        if (u && u.tier === this.blinkTier) els.root.classList.add('just-unlocked');
      });
    }
  }

  toggleFavorite(u) {
    const fav = this.game.meta.favorites;
    if (fav[u.id]) delete fav[u.id];
    else fav[u.id] = true;
    this.game.requestSave();
    this.game.sfx.unlock();
    this.buildList();
  }

  /** 解放直後のTierを記録し、次回描画で点滅させる */
  markTierUnlocked(tier) {
    this.blinkTier = tier;
    if (this.isOpen) this.buildList();
    // 一定時間で点滅を解除する
    if (this._blinkTimer) clearTimeout(this._blinkTimer);
    this._blinkTimer = setTimeout(() => {
      this.blinkTier = null;
      if (this.isOpen) this.buildList();
    }, 12000);
  }

  refresh(force) {
    if (!this.isOpen && !force) return;
    const g = this.game;
    const cash = g.cash;
    this.cashEl.textContent = formatNumber(cash);

    this.itemEls.forEach((els, id) => {
      const u = UPGRADES.find((x) => x.id === id);
      if (!u) return;

      // ---- 未解放 ----
      if (!els.unlocked) {
        els.level.textContent = '';
        els.value.textContent = 'TIER ' + u.tier;
        els.badge.classList.remove('show');
        els.btn.classList.add('disabled');
        els.btn.classList.remove('maxed');
        els.count.textContent = 'LOCK';
        els.cost.textContent = 'W' + requiredWaveOf(u);
        return;
      }

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

      // ---- おすすめ判定: 所持金の25%以下で買える、伸びしろのある項目 ----
      const single = upgradeCostAt(u, u.level);
      const recommended =
        !maxed && cash > 0 && single <= cash * 0.25 && u.level < u.maxLevel * 0.8;
      els.badge.classList.toggle('show', recommended);

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
    this.game.closePanels(this);
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
      if (t.hidden) continue;   // 分裂片などの内部専用種は表示しない
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
 * 9.5 永続研究パネル（RESEARCH配列から自動生成）
 * ======================================================= */

class Research {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('research-panel');
    this.listEl = document.getElementById('research-list');
    this.coinEl = document.getElementById('val-research-coin');
    this.isOpen = false;
    this.itemEls = new Map();

    document.getElementById('btn-research')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-research-close')
      .addEventListener('click', () => this.close());

    this.build();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.refresh();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  build() {
    this.listEl.textContent = '';
    this.itemEls.clear();

    // 解放される順（Tier昇順）に並べる。解放済みが必ず前へ来る
    const sorted = RESEARCH.slice().sort((a, b) => {
      const wa = requiredWaveOf(a);
      const wb = requiredWaveOf(b);
      if (wa !== wb) return wa - wb;
      return RESEARCH.indexOf(a) - RESEARCH.indexOf(b);
    });

    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const unlocked = this.game.isUnlocked(r);

      const root = document.createElement('div');
      root.className = 'shop-item' + (unlocked ? '' : ' locked');

      const info = document.createElement('div');
      info.className = 'shop-item-info';

      const top = document.createElement('div');
      top.className = 'shop-item-top';
      const name = document.createElement('span');
      name.className = 'shop-item-name';
      name.textContent = unlocked ? r.name : '？？？';
      const level = document.createElement('span');
      level.className = 'shop-item-level';
      top.appendChild(name);
      top.appendChild(level);

      const desc = document.createElement('div');
      desc.className = 'shop-item-desc';
      desc.textContent = unlocked
        ? r.description
        : 'WAVE ' + requiredWaveOf(r) + ' で解放';

      const value = document.createElement('div');
      value.className = 'shop-item-value';

      info.appendChild(top);
      info.appendChild(desc);
      info.appendChild(value);

      const btn = document.createElement('button');
      btn.className = 'shop-buy-btn research-buy-btn';
      const count = document.createElement('span');
      count.className = 'buy-count';
      count.textContent = '研究';
      const cost = document.createElement('span');
      cost.className = 'buy-cost';
      btn.appendChild(count);
      btn.appendChild(cost);
      if (unlocked) btn.addEventListener('click', () => this.buy(r));

      root.appendChild(info);
      root.appendChild(btn);
      this.listEl.appendChild(root);

      this.itemEls.set(r.id, { root, level, value, btn, count, cost, unlocked });
    }
    this.refresh();
  }

  refresh() {
    const coin = this.game.meta.coin;
    this.coinEl.textContent = formatNumber(coin);

    for (let i = 0; i < RESEARCH.length; i++) {
      const r = RESEARCH[i];
      const els = this.itemEls.get(r.id);
      if (!els) continue;

      if (!els.unlocked) {
        els.level.textContent = '';
        els.value.textContent = 'TIER ' + r.tier;
        els.btn.classList.add('disabled');
        els.btn.classList.remove('maxed');
        els.count.textContent = 'LOCK';
        els.cost.textContent = 'W' + requiredWaveOf(r);
        continue;
      }

      const maxed = r.level >= r.maxLevel;
      const price = upgradeCostAt(r, r.level);
      els.level.textContent = 'Lv ' + r.level + '/' + r.maxLevel;
      els.value.textContent = maxed
        ? r.valueText(r.level)
        : r.valueText(r.level) + ' → ' + r.valueText(r.level + 1);

      if (maxed) {
        els.btn.classList.add('maxed');
        els.btn.classList.remove('disabled');
        els.count.textContent = 'MAX';
        els.cost.textContent = '─';
      } else {
        els.btn.classList.remove('maxed');
        els.btn.classList.toggle('disabled', coin < price);
        els.count.textContent = '研究';
        els.cost.textContent = formatNumber(price) + '◎';
      }
    }
  }

  buy(r) {
    const g = this.game;
    g.sfx.unlock();
    const els = this.itemEls.get(r.id);
    if (r.level >= r.maxLevel) return;
    if (!g.isUnlocked(r)) return;

    const price = upgradeCostAt(r, r.level);
    if (g.meta.coin < price) {
      g.sfx.deny();
      if (els) {
        els.btn.classList.remove('deny');
        void els.btn.offsetWidth;
        els.btn.classList.add('deny');
      }
      return;
    }

    g.meta.coin -= price;
    r.level++;
    g.player.recalc();
    g.sfx.research();

    if (els) {
      els.btn.classList.remove('glow');
      els.level.classList.remove('pop');
      void els.btn.offsetWidth;
      els.btn.classList.add('glow');
      els.level.classList.add('pop');
    }

    g.requestSave();
    g.flushSave();
    g.checkAchievements();
    this.refresh();
    g.hudDirty = true;
  }
}

/* =========================================================
 * 9.55 LABパネル（LAB_RESEARCH配列から自動生成）
 * ======================================================= */

class Lab {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('lab-panel');
    this.listEl = document.getElementById('lab-list');
    this.coinEl = document.getElementById('val-lab-coin');
    this.gemEl = document.getElementById('val-lab-gem');
    this.slotEl = document.getElementById('lab-slot-info');
    this.slotBtn = document.getElementById('btn-lab-slot');
    this.adBtn = document.getElementById('btn-lab-ad');
    this.activeCategory = LAB_CATEGORIES[0].id;
    this.isOpen = false;
    this.itemEls = new Map();
    this.tickTimer = 0;

    document.getElementById('btn-lab')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-lab-close')
      .addEventListener('click', () => this.close());

    const tabs = document.querySelectorAll('.lab-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = tab.dataset.category;
        this.build();
      });
    });

    this.slotBtn.addEventListener('click', () => this.onBuySlot());
    this.adBtn.addEventListener('click', () => this.onWatchAd());
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.build();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  onBuySlot() {
    const g = this.game;
    g.sfx.unlock();
    if (g.buyLabSlot()) {
      g.sfx.research();
      g.showToast('研究スロットを拡張しました');
    } else {
      g.sfx.deny();
    }
    this.build();
  }

  onWatchAd() {
    const g = this.game;
    g.sfx.unlock();
    const amount = g.watchAd();
    if (amount > 0) {
      g.showToast('広告視聴報酬  +' + amount + ' ◆', 2400);
      g.sfx.achievement();
    } else {
      g.sfx.deny();
      g.showToast('本日の視聴回数の上限に達しています');
    }
    this.refresh();
  }

  build() {
    const g = this.game;
    this.listEl.textContent = '';
    this.itemEls.clear();

    // 解放される順（Tier昇順）に並べる
    const sorted = LAB_RESEARCH
      .filter((r) => r.category === this.activeCategory)
      .sort((a, b) => {
        const wa = requiredWaveOf(a);
        const wb = requiredWaveOf(b);
        if (wa !== wb) return wa - wb;
        return LAB_RESEARCH.indexOf(a) - LAB_RESEARCH.indexOf(b);
      });

    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const unlocked = g.isUnlocked(r);

      const root = document.createElement('div');
      root.className = 'lab-item' + (unlocked ? '' : ' locked');

      const info = document.createElement('div');
      info.className = 'shop-item-info';

      const top = document.createElement('div');
      top.className = 'shop-item-top';
      const name = document.createElement('span');
      name.className = 'shop-item-name';
      name.textContent = unlocked ? r.name : '？？？';
      const level = document.createElement('span');
      level.className = 'shop-item-level';
      top.appendChild(name);
      top.appendChild(level);

      const desc = document.createElement('div');
      desc.className = 'shop-item-desc';
      desc.textContent = unlocked
        ? r.description
        : 'WAVE ' + requiredWaveOf(r) + ' で解放';

      const value = document.createElement('div');
      value.className = 'shop-item-value';

      const meta = document.createElement('div');
      meta.className = 'lab-meta';

      info.appendChild(top);
      info.appendChild(desc);
      info.appendChild(value);
      info.appendChild(meta);

      // 進行バー
      const bar = document.createElement('div');
      bar.className = 'lab-bar';
      const fill = document.createElement('div');
      fill.className = 'lab-bar-fill';
      bar.appendChild(fill);
      info.appendChild(bar);

      const btn = document.createElement('button');
      btn.className = 'shop-buy-btn lab-btn';
      const count = document.createElement('span');
      count.className = 'buy-count';
      const cost = document.createElement('span');
      cost.className = 'buy-cost';
      btn.appendChild(count);
      btn.appendChild(cost);
      if (unlocked) btn.addEventListener('click', () => this.onAction(r));

      root.appendChild(info);
      root.appendChild(btn);
      this.listEl.appendChild(root);

      this.itemEls.set(r.id, {
        root, level, value, meta, bar, fill, btn, count, cost, unlocked,
      });
    }
    this.refresh();
  }

  /** ボタン押下: 未着手なら開始、進行中ならGemで即完了 */
  onAction(r) {
    const g = this.game;
    g.sfx.unlock();
    const job = g.labJobOf(r.id);

    if (job) {
      if (g.rushLabJob(job)) {
        g.showToast(r.name + ' の研究を完了させました');
      } else {
        g.sfx.deny();
        g.showToast('Gem が不足しています');
      }
      this.build();
      return;
    }

    if (r.level >= r.maxLevel) return;
    if (g.labFreeSlots() <= 0) {
      g.sfx.deny();
      g.showToast('空いている研究スロットがありません');
      return;
    }
    if (g.startLabJob(r)) {
      g.sfx.buy();
      g.showToast(r.name + ' の研究を開始しました');
    } else {
      g.sfx.deny();
      g.showToast('Coin が不足しています');
    }
    this.build();
  }

  refresh() {
    const g = this.game;
    const now = Date.now();

    this.coinEl.textContent = formatNumber(g.meta.coin);
    this.gemEl.textContent = formatNumber(g.meta.gem);
    this.slotEl.textContent =
      '研究スロット ' + g.meta.labJobs.length + ' / ' + g.meta.labSlots;

    // スロット拡張ボタン
    if (g.meta.labSlots >= LAB_SLOT_COSTS.length) {
      this.slotBtn.textContent = 'スロット最大';
      this.slotBtn.classList.add('disabled');
    } else {
      const price = LAB_SLOT_COSTS[g.meta.labSlots];
      this.slotBtn.textContent = 'スロット拡張  ' + price + '◆';
      this.slotBtn.classList.toggle('disabled', g.meta.gem < price);
    }

    const adLeft = g.adRemainingToday();
    this.adBtn.textContent = adLeft > 0
      ? '広告を見て +5◆（本日あと' + adLeft + '回）'
      : '本日の視聴上限に達しました';
    this.adBtn.classList.toggle('disabled', adLeft <= 0);

    this.itemEls.forEach((els, id) => {
      const r = g.labById(id);
      if (!r) return;
      const job = g.labJobOf(id);
      const maxed = r.level >= r.maxLevel;

      if (!els.unlocked) {
        els.level.textContent = '';
        els.value.textContent = 'TIER ' + r.tier;
        els.meta.textContent = '';
        els.bar.classList.remove('show');
        els.btn.classList.add('disabled');
        els.btn.classList.remove('maxed');
        els.count.textContent = 'LOCK';
        els.cost.textContent = 'W' + requiredWaveOf(r);
        return;
      }

      els.level.textContent = 'Lv ' + r.level + '/' + r.maxLevel;
      els.value.textContent = maxed
        ? r.valueText(r.level)
        : r.valueText(r.level) + ' → ' + r.valueText(r.level + 1);

      // ---- 進行中 ----
      if (job) {
        const duration = labDurationAt(r, job.level - 1);
        const remaining = Math.max(0, (job.endsAt - now) / 1000);
        const progress = duration > 0 ? 1 - remaining / duration : 1;
        els.root.classList.add('running');
        els.bar.classList.add('show');
        els.fill.style.width = (Math.min(Math.max(progress, 0), 1) * 100).toFixed(1) + '%';
        els.meta.textContent = '残り ' + formatDuration(remaining);
        els.btn.classList.remove('disabled', 'maxed');
        els.count.textContent = '即完了';
        els.cost.textContent = labSpeedupGemCost(remaining) + '◆';
        return;
      }

      els.root.classList.remove('running');
      els.bar.classList.remove('show');

      if (maxed) {
        els.meta.textContent = '研究完了';
        els.btn.classList.add('maxed');
        els.btn.classList.remove('disabled');
        els.count.textContent = 'MAX';
        els.cost.textContent = '─';
        return;
      }

      const price = labCostAt(r, r.level);
      const duration = labDurationAt(r, r.level);
      els.meta.textContent = '所要 ' + formatDuration(duration);
      els.btn.classList.remove('maxed');
      const canStart = g.meta.coin >= price && g.labFreeSlots() > 0;
      els.btn.classList.toggle('disabled', !canStart);
      els.count.textContent = '研究';
      els.cost.textContent = formatNumber(price) + '◎';
    });
  }

  /** 進行バーの更新（0.5秒間隔） */
  update(dt) {
    if (!this.isOpen) return;
    this.tickTimer += dt;
    if (this.tickTimer < 0.5) return;
    this.tickTimer = 0;
    this.refresh();
  }
}

/* =========================================================
 * 9.57 モジュールパネル（装備・強化・分解）
 * ======================================================= */

class Modules {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('modules-panel');
    this.listEl = document.getElementById('modules-list');
    this.slotsEl = document.getElementById('module-slots');
    this.shardEl = document.getElementById('val-module-shard');
    this.activeType = 'all';
    this.isOpen = false;

    document.getElementById('btn-modules')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-modules-close')
      .addEventListener('click', () => this.close());

    const tabs = document.querySelectorAll('.module-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeType = tab.dataset.type;
        this.build();
      });
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.build();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
  }

  /** 装備枠の表示 */
  buildSlots() {
    const g = this.game;
    this.slotsEl.textContent = '';

    for (let i = 0; i < MODULE_TYPES.length; i++) {
      const type = MODULE_TYPES[i];
      const uid = g.meta.equipped[type.id];
      const mod = uid ? g.moduleByUid(uid) : null;

      const slot = document.createElement('div');
      slot.className = 'module-slot' + (mod ? ' filled' : '');
      slot.style.borderColor = mod
        ? rarityById(mod.rarity).color
        : 'rgba(0,229,255,0.2)';

      const label = document.createElement('div');
      label.className = 'module-slot-label';
      label.textContent = type.label;
      label.style.color = type.color;

      const name = document.createElement('div');
      name.className = 'module-slot-name';
      if (mod) {
        const bp = blueprintById(mod.bp);
        name.textContent = bp ? bp.name : '?';
        name.style.color = rarityById(mod.rarity).color;
      } else {
        name.textContent = '未装備';
      }

      const lv = document.createElement('div');
      lv.className = 'module-slot-lv';
      lv.textContent = mod ? '+' + mod.level : '─';

      slot.appendChild(label);
      slot.appendChild(name);
      slot.appendChild(lv);
      if (mod) slot.addEventListener('click', () => this.onUnequip(type.id));
      this.slotsEl.appendChild(slot);
    }
  }

  onUnequip(typeId) {
    this.game.sfx.unlock();
    this.game.unequipModule(typeId);
    this.game.sfx.deny();
    this.build();
  }

  build() {
    const g = this.game;
    this.buildSlots();
    this.shardEl.textContent = formatNumber(g.meta.shards);
    this.listEl.textContent = '';

    // 装備中を先頭、その後レアリティ降順・レベル降順
    const list = g.meta.modules.slice().sort((a, b) => {
      const bpa = blueprintById(a.bp);
      const bpb = blueprintById(b.bp);
      const ea = bpa && g.meta.equipped[bpa.type] === a.uid ? 0 : 1;
      const eb = bpb && g.meta.equipped[bpb.type] === b.uid ? 0 : 1;
      if (ea !== eb) return ea - eb;
      const ra = rarityIndex(b.rarity) - rarityIndex(a.rarity);
      if (ra !== 0) return ra;
      return b.level - a.level;
    });

    const filtered = this.activeType === 'all'
      ? list
      : list.filter((m) => {
          const bp = blueprintById(m.bp);
          return bp && bp.type === this.activeType;
        });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty';
      empty.textContent = 'モジュールを所持していません。ガチャで入手できます。';
      this.listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      this.listEl.appendChild(this.buildCard(filtered[i]));
    }
  }

  buildCard(mod) {
    const g = this.game;
    const bp = blueprintById(mod.bp);
    const rar = rarityById(mod.rarity);
    const equipped = bp && g.meta.equipped[bp.type] === mod.uid;
    const power = modulePower(mod.rarity, mod.level);

    const root = document.createElement('div');
    root.className = 'module-card' + (equipped ? ' equipped' : '');
    root.style.borderColor = rar.color;

    const head = document.createElement('div');
    head.className = 'module-head';

    const name = document.createElement('span');
    name.className = 'module-name';
    name.textContent = bp ? bp.name : '?';
    name.style.color = rar.color;

    const rarity = document.createElement('span');
    rarity.className = 'module-rarity';
    rarity.textContent = rar.name;
    rarity.style.color = rar.color;

    const lv = document.createElement('span');
    lv.className = 'module-lv';
    lv.textContent = '+' + mod.level + '/' + MODULE_MAX_LEVEL;

    head.appendChild(name);
    head.appendChild(rarity);
    head.appendChild(lv);

    const fixed = document.createElement('div');
    fixed.className = 'module-fixed';
    fixed.textContent = bp ? bp.fixedText(power) : '';

    root.appendChild(head);
    root.appendChild(fixed);

    // ランダム能力
    if (mod.subs.length > 0) {
      const subs = document.createElement('div');
      subs.className = 'module-subs';
      for (let i = 0; i < mod.subs.length; i++) {
        const def = substatById(mod.subs[i].id);
        if (!def) continue;
        const row = document.createElement('div');
        row.className = 'module-sub';
        const k = document.createElement('span');
        k.textContent = def.name;
        const v = document.createElement('span');
        v.className = 'module-sub-val';
        v.textContent = def.format(mod.subs[i].value);
        row.appendChild(k);
        row.appendChild(v);
        subs.appendChild(row);
      }
      root.appendChild(subs);
    }

    // 操作ボタン
    const actions = document.createElement('div');
    actions.className = 'module-actions';

    const equipBtn = document.createElement('button');
    equipBtn.className = 'module-btn';
    equipBtn.textContent = equipped ? '装備中' : '装備';
    if (equipped) equipBtn.classList.add('disabled');
    else equipBtn.addEventListener('click', () => {
      g.sfx.unlock();
      g.equipModule(mod);
      g.sfx.buy();
      this.build();
    });

    const upBtn = document.createElement('button');
    upBtn.className = 'module-btn';
    if (mod.level >= MODULE_MAX_LEVEL) {
      upBtn.textContent = 'MAX';
      upBtn.classList.add('disabled');
    } else {
      const cost = moduleUpgradeCost(mod.rarity, mod.level);
      upBtn.textContent = '強化 ' + cost + '◈';
      if (g.meta.shards < cost) upBtn.classList.add('disabled');
      upBtn.addEventListener('click', () => {
        g.sfx.unlock();
        if (g.upgradeModule(mod)) g.sfx.research();
        else g.sfx.deny();
        this.build();
      });
    }

    const scrapBtn = document.createElement('button');
    scrapBtn.className = 'module-btn danger';
    scrapBtn.textContent = equipped ? '─' : '分解';
    if (equipped) scrapBtn.classList.add('disabled');
    else scrapBtn.addEventListener('click', () => {
      g.sfx.unlock();
      const gained = g.dismantleModule(mod);
      if (gained) {
        g.showToast('分解して ' + gained + ' シャードを得ました');
        g.sfx.buy();
      } else {
        g.sfx.deny();
      }
      this.build();
    });

    actions.appendChild(equipBtn);
    actions.appendChild(upBtn);
    actions.appendChild(scrapBtn);
    root.appendChild(actions);
    return root;
  }
}

/* =========================================================
 * 9.58 ガチャパネル（排出演出つき）
 * ======================================================= */

class Gacha {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('gacha-panel');
    this.gemEl = document.getElementById('val-gacha-gem');
    this.resultEl = document.getElementById('gacha-results');
    this.rateEl = document.getElementById('gacha-rates');
    this.skinListEl = document.getElementById('gacha-skins');
    this.isOpen = false;
    this.revealTimers = [];

    document.getElementById('btn-gacha')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-gacha-close')
      .addEventListener('click', () => this.close());
    document.getElementById('btn-gacha-1')
      .addEventListener('click', () => this.pull(1));
    document.getElementById('btn-gacha-10')
      .addEventListener('click', () => this.pull(GACHA_MULTI_COUNT));

    this.buildRates();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    this.refresh();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
    this.clearTimers();
  }

  clearTimers() {
    for (let i = 0; i < this.revealTimers.length; i++) {
      clearTimeout(this.revealTimers[i]);
    }
    this.revealTimers.length = 0;
  }

  /** 排出率の表示（RARITIES から自動生成） */
  buildRates() {
    let total = 0;
    for (let i = 0; i < RARITIES.length; i++) total += RARITIES[i].weight;

    this.rateEl.textContent = '';
    for (let i = 0; i < RARITIES.length; i++) {
      const r = RARITIES[i];
      const row = document.createElement('div');
      row.className = 'gacha-rate-row';
      const k = document.createElement('span');
      k.textContent = r.name;
      k.style.color = r.color;
      const v = document.createElement('span');
      v.textContent = ((r.weight / total) * 100).toFixed(2) + '%';
      row.appendChild(k);
      row.appendChild(v);
      this.rateEl.appendChild(row);
    }
  }

  refresh() {
    const g = this.game;
    this.gemEl.textContent = formatNumber(g.meta.gem);
    document.getElementById('btn-gacha-1')
      .classList.toggle('disabled', g.meta.gem < GACHA_SINGLE_COST);
    document.getElementById('btn-gacha-10')
      .classList.toggle('disabled', g.meta.gem < GACHA_MULTI_COST);
    this.buildSkins();
  }

  /** 所持スキンの一覧と切替 */
  buildSkins() {
    const g = this.game;
    this.skinListEl.textContent = '';

    for (let i = 0; i < SKINS.length; i++) {
      const sk = SKINS[i];
      const owned = g.meta.skins.indexOf(sk.id) !== -1;
      const active = g.meta.activeSkin === sk.id;

      const chip = document.createElement('button');
      chip.className = 'skin-chip' +
        (owned ? '' : ' locked') + (active ? ' active' : '');
      chip.style.borderColor = owned ? sk.core : 'rgba(109,138,163,0.3)';

      const dot = document.createElement('span');
      dot.className = 'skin-dot';
      dot.style.background = owned ? sk.core : '#1a2536';
      dot.style.boxShadow = owned ? '0 0 8px ' + sk.core : 'none';

      const label = document.createElement('span');
      label.textContent = owned ? sk.name : '???';
      if (owned) label.style.color = sk.core;

      chip.appendChild(dot);
      chip.appendChild(label);
      if (owned) {
        chip.addEventListener('click', () => {
          g.sfx.unlock();
          g.setSkin(sk.id);
          g.sfx.buy();
          this.buildSkins();
        });
      }
      this.skinListEl.appendChild(chip);
    }
  }

  pull(count) {
    const g = this.game;
    g.sfx.unlock();

    const results = g.pullGacha(count);
    if (!results) {
      g.sfx.deny();
      g.showToast('Gem が不足しています');
      return;
    }

    this.clearTimers();
    this.resultEl.textContent = '';
    this.refresh();

    // 1件ずつ順番に開示して演出をつける
    for (let i = 0; i < results.length; i++) {
      const card = this.buildResultCard(results[i]);
      this.resultEl.appendChild(card);
      const timer = setTimeout(() => {
        card.classList.add('revealed');
        this.onReveal(results[i]);
      }, 140 * i + 120);
      this.revealTimers.push(timer);
    }
  }

  /** レアリティに応じた演出 */
  onReveal(result) {
    const g = this.game;
    const idx = rarityIndex(result.rarity);
    const rar = rarityById(result.rarity);

    if (idx >= 3) {
      // Legend 以上は特別演出
      g.flashScreen(0.3, rar.color);
      g.shakeScreen(idx >= 4 ? 12 : 7);
      g.sfx.gachaRare(idx);
      if (idx >= 4) {
        g.showToast(rar.name + ' 排出！  ' + this.resultName(result), 3200);
      }
    } else {
      g.sfx.gachaCommon();
    }
  }

  resultName(result) {
    if (result.kind === 'skin') return result.skin.name;
    const bp = blueprintById(result.module.bp);
    return bp ? bp.name : '?';
  }

  buildResultCard(result) {
    const rar = rarityById(result.rarity);
    const card = document.createElement('div');
    card.className = 'gacha-card rarity-' + result.rarity;
    card.style.borderColor = rar.color;

    const rarityEl = document.createElement('div');
    rarityEl.className = 'gacha-card-rarity';
    rarityEl.textContent = rar.name;
    rarityEl.style.color = rar.color;

    const nameEl = document.createElement('div');
    nameEl.className = 'gacha-card-name';
    nameEl.textContent = this.resultName(result);
    nameEl.style.color = rar.color;

    const subEl = document.createElement('div');
    subEl.className = 'gacha-card-sub';

    if (result.kind === 'skin') {
      subEl.textContent = result.duplicate
        ? '所持済み → ' + result.shards + ' シャード'
        : 'スキン獲得';
    } else {
      const bp = blueprintById(result.module.bp);
      const type = MODULE_TYPES.find((t) => t.id === bp.type);
      subEl.textContent = result.overflow
        ? '所持上限 → ' + result.shards + ' シャード'
        : (type ? type.label : '') + 'モジュール / 能力' +
          result.module.subs.length + '個';
    }

    card.appendChild(rarityEl);
    card.appendChild(nameEl);
    card.appendChild(subEl);
    return card;
  }
}

/* =========================================================
 * 9.59 属性コアパネル（ELEMENTS配列から自動生成）
 * ======================================================= */

class Elements {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('elements-panel');
    this.listEl = document.getElementById('elements-list');
    this.noteEl = document.getElementById('elements-note');
    this.isOpen = false;

    document.getElementById('btn-elements')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-elements-close')
      .addEventListener('click', () => this.close());
    document.getElementById('btn-tooltip-close')
      .addEventListener('click', () => {
        document.getElementById('overlay-tooltip').classList.add('hidden');
      });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
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
    const power = g.elementPower();
    this.listEl.textContent = '';

    this.noteEl.textContent = g.running
      ? '戦闘中の変更は次の周回から反映されます。'
      : '属性を選ぶと戦い方が大きく変わります。';

    document.getElementById('val-element-frag').textContent =
      formatNumber(g.meta.fragments);

    this.listEl.appendChild(this.buildOverclockCard());

    const head = document.createElement('div');
    head.className = 'element-section';
    head.textContent = '属性コア';
    this.listEl.appendChild(head);

    // 移行のお知らせ（初回のみ）
    if (g.migrationNotice) {
      const notice = document.createElement('div');
      notice.className = 'element-notice';
      notice.textContent = g.migrationNotice;
      this.listEl.appendChild(notice);
    }

    // おすすめガイド
    const rec = g.recommendedElement();
    if (rec) {
      const el = elementById(rec.id);
      const box = document.createElement('div');
      box.className = 'element-rec';
      box.style.borderColor = el.color;

      const t = document.createElement('div');
      t.className = 'element-rec-title';
      t.textContent = 'おすすめ： ' + el.icon + ' ' + el.name;
      t.style.color = el.color;
      box.appendChild(t);

      for (let i = 0; i < rec.reasons.length; i++) {
        const r = document.createElement('div');
        r.className = 'element-rec-reason';
        r.textContent = '・' + rec.reasons[i];
        box.appendChild(r);
      }
      const note = document.createElement('div');
      note.className = 'element-rec-note';
      note.textContent = 'ガイドとしての提示です。どの属性から解放しても構いません。';
      box.appendChild(note);
      this.listEl.appendChild(box);
    }

    for (let i = 0; i < ELEMENTS.length; i++) {
      this.listEl.appendChild(this.buildElementCard(ELEMENTS[i], power));
    }
  }

  /** オーバークロックの現在値をまとめたカード */
  buildOverclockCard() {
    const g = this.game;
    const p = g.player;
    const st = p.stats;
    const mastery = RESEARCH.find((r) => r.id === 'overclockMastery');
    const bonus = p.heatBonus();

    const card = document.createElement('div');
    card.className = 'oc-card' + (st.superOverclock ? ' super' : '');

    const title = document.createElement('div');
    title.className = 'oc-title';
    title.textContent = st.superOverclock
      ? '★ SUPER OVERCLOCK 解放済み'
      : 'オーバークロック';
    card.appendChild(title);

    const rows = [
      ['現在の状態', p.heatState === 'super' ? 'SUPER'
        : p.heatState === 'overclock' ? 'OVERCLOCK'
        : p.heatState === 'overheat' ? 'OVERHEAT' : '通常'],
      ['現在倍率', '攻撃速度 ×' + bonus.aspd.toFixed(2) +
        ' / ダメージ ×' + bonus.dmg.toFixed(2)],
      ['熱ゲージ倍率', '×' + st.heatGainMul.toFixed(2) +
        '（強化幅 ×' + st.heatBonusMul.toFixed(2) + '）'],
      ['持続時間', (CONFIG.OVERCLOCK_DURATION + st.overclockDuration).toFixed(1) + '秒'],
      ['オーバーヒート', Math.max(
        CONFIG.OVERHEAT_DURATION - st.overheatReduction, 0.8).toFixed(1) + '秒'],
      ['Mastery', mastery ? 'Lv' + mastery.level + ' / ' + mastery.maxLevel : '─'],
    ];

    for (let i = 0; i < rows.length; i++) {
      const row = document.createElement('div');
      row.className = 'oc-row';
      const k = document.createElement('span');
      k.className = 'oc-key';
      k.textContent = rows[i][0];
      const v = document.createElement('span');
      v.className = 'oc-val';
      v.textContent = rows[i][1];
      row.appendChild(k);
      row.appendChild(v);
      card.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.className = 'oc-hint';
    hint.textContent = st.superOverclock
      ? 'ゲージ満タンで SUPER OVERCLOCK が発動します。'
      : 'Overclock Mastery（研究）を Lv5 にすると SUPER OVERCLOCK が解放されます。';
    card.appendChild(hint);
    return card;
  }

  /** 属性カード。解放状況・レベル・ガイド・専用研究を表示する */
  buildElementCard(el, power) {
    const g = this.game;
    const unlocked = g.isElementUnlocked(el.id);
    const active = g.meta.activeElement === el.id;
    const pending = g.meta.pendingElement === el.id && !active;
    const rec = g.recommendedElement();

    const card = document.createElement('div');
    card.className = 'element-card' +
      (active ? ' active' : '') + (pending ? ' pending' : '') +
      (unlocked ? '' : ' locked');
    card.style.borderColor = unlocked ? el.color : 'rgba(109,138,163,0.25)';

    // ---- 見出し ----
    const head = document.createElement('div');
    head.className = 'element-head';

    const icon = document.createElement('span');
    icon.className = 'element-icon';
    icon.textContent = el.icon;
    icon.style.color = unlocked ? el.color : 'var(--text-dim)';

    const name = document.createElement('span');
    name.className = 'element-name';
    name.textContent = el.name;
    name.style.color = unlocked ? el.color : 'var(--text-dim)';

    head.appendChild(icon);
    head.appendChild(name);

    if (unlocked) {
      const lvBadge = document.createElement('span');
      lvBadge.className = 'element-lv';
      lvBadge.textContent = 'Lv ' + g.elementLevelOf(el.id);
      lvBadge.style.color = el.color;
      head.appendChild(lvBadge);
    }

    if (rec && rec.id === el.id) {
      const recBadge = document.createElement('span');
      recBadge.className = 'element-rec-badge';
      recBadge.textContent = 'おすすめ';
      head.appendChild(recBadge);
    }

    // ツールチップ
    const help = document.createElement('button');
    help.className = 'element-help';
    help.textContent = '？';
    help.addEventListener('click', (ev) => {
      ev.stopPropagation();
      g.sfx.unlock();
      this.showTooltip(el);
    });
    head.appendChild(help);
    card.appendChild(head);

    // ---- ガイド（おすすめ度・特徴）----
    const guide = document.createElement('div');
    guide.className = 'element-guide';

    const stars = document.createElement('div');
    stars.className = 'element-stars';
    stars.textContent = '★'.repeat(el.rating) + '☆'.repeat(5 - el.rating);
    stars.style.color = el.color;

    const arche = document.createElement('span');
    arche.className = 'element-arche';
    arche.textContent = '【' + el.archetype + '】';

    const gtext = document.createElement('div');
    gtext.className = 'element-guide-text';
    gtext.textContent = el.guide;

    stars.appendChild(arche);
    guide.appendChild(stars);
    guide.appendChild(gtext);
    card.appendChild(guide);

    // ---- 未解放: 解放ボタン ----
    if (!unlocked) {
      const cost = g.nextUnlockCost();
      const cond = document.createElement('div');
      cond.className = 'element-cond';
      cond.textContent = '解放に Core Fragment ' + cost + ' 個';
      card.appendChild(cond);

      const prog = document.createElement('div');
      prog.className = 'element-cond-progress';
      prog.textContent = '所持 ' + g.meta.fragments + ' / ' + cost;
      card.appendChild(prog);

      const btn = document.createElement('button');
      btn.className = 'element-select unlock';
      const afford = g.meta.fragments >= cost;
      btn.textContent = afford
        ? 'このコアを解放する（' + cost + ' ◆◆）'
        : 'Core Fragment が ' + (cost - g.meta.fragments) + ' 個不足';
      if (!afford) btn.classList.add('disabled');
      btn.addEventListener('click', () => {
        g.sfx.unlock();
        if (g.unlockElement(el.id)) {
          g.sfx.buy();
        } else {
          g.sfx.deny();
          g.showToast('Core Fragment が不足しています');
        }
        this.build();
      });
      card.appendChild(btn);
      return card;
    }

    // ---- 説明 ----
    const desc = document.createElement('div');
    desc.className = 'element-desc';
    desc.textContent = el.desc;
    card.appendChild(desc);

    // ---- 経験値バーと昇格 ----
    const level = g.elementLevelOf(el.id);
    const exp = g.elementExpOf(el.id);
    const maxLv = el.expTable.length;
    const cur = el.expTable[level - 1];
    const next = level < maxLv ? el.expTable[level] : null;

    const expWrap = document.createElement('div');
    expWrap.className = 'element-exp';
    const bar = document.createElement('div');
    bar.className = 'element-exp-bar';
    const fill = document.createElement('div');
    fill.className = 'element-exp-fill';
    fill.style.background = el.color;
    fill.style.width = next
      ? (Math.min((exp - cur) / (next - cur), 1) * 100).toFixed(1) + '%'
      : '100%';
    bar.appendChild(fill);

    const expText = document.createElement('div');
    expText.className = 'element-exp-text';
    expText.textContent = next
      ? '撃破 ' + formatNumber(exp) + ' / ' + formatNumber(next)
      : '撃破 ' + formatNumber(exp) + '（最大レベル）';

    expWrap.appendChild(bar);
    expWrap.appendChild(expText);
    card.appendChild(expWrap);

    // ---- 現在効果と次レベル効果 ----
    const state = g.elementState(el.id);
    const P = elementParams(el, level, state.research);

    const effect = document.createElement('div');
    effect.className = 'element-effect';
    effect.textContent = '現在: ' + el.effectText(P, power);
    card.appendChild(effect);

    if (next) {
      const perk = el.levelPerks[level];
      const nextEl = document.createElement('div');
      nextEl.className = 'element-next';
      nextEl.textContent = 'Lv' + (level + 1) + ': ' + (perk ? perk.text : '─');
      card.appendChild(nextEl);

      // 昇格ボタン
      const check = g.canLevelUpElement(el.id);
      const up = document.createElement('button');
      up.className = 'element-levelup';
      if (check.ok) {
        up.textContent = 'Lv' + (level + 1) + ' へ昇格（' + check.cost + ' ◆◆）';
        up.addEventListener('click', () => {
          g.sfx.unlock();
          if (g.levelUpElement(el.id)) g.sfx.research();
          else g.sfx.deny();
          this.build();
        });
      } else {
        up.classList.add('disabled');
        up.textContent = check.reason === 'exp'
          ? '撃破 ' + formatNumber(check.needExp) + ' で昇格可能'
          : 'Core Fragment ' + check.cost + ' 個が必要';
      }
      card.appendChild(up);
    }

    // ---- 専用研究 ----
    const resWrap = document.createElement('div');
    resWrap.className = 'element-research';
    const resTitle = document.createElement('div');
    resTitle.className = 'element-research-title';
    resTitle.textContent = el.name + ' 専用研究（Coin）';
    resWrap.appendChild(resTitle);

    for (let i = 0; i < el.research.length; i++) {
      resWrap.appendChild(this.buildResearchRow(el, el.research[i]));
    }
    card.appendChild(resWrap);

    // ---- 選択 ----
    const sel = document.createElement('button');
    sel.className = 'element-select';
    sel.textContent = active ? '使用中' : pending ? '次の周回から適用' : 'このコアを装填';
    if (active) {
      sel.classList.add('disabled');
      sel.style.color = el.color;
    } else {
      sel.addEventListener('click', () => {
        g.sfx.unlock();
        if (g.selectElement(el.id)) {
          g.sfx.buy();
          g.showToast(
            g.running
              ? el.name + ' を次の周回に設定しました'
              : el.name + ' を装填しました'
          );
        } else {
          g.sfx.deny();
        }
        this.build();
      });
    }
    card.appendChild(sel);
    return card;
  }

  /** 「？」で開く詳細説明。データ配列から自動生成する */
  showTooltip(el) {
    const box = document.getElementById('overlay-tooltip');
    document.getElementById('tooltip-icon').textContent = el.icon;
    document.getElementById('tooltip-icon').style.color = el.color;
    document.getElementById('tooltip-name').textContent = el.name;
    document.getElementById('tooltip-name').style.color = el.color;
    document.getElementById('tooltip-arche').textContent =
      '【' + el.archetype + '】  ' + '★'.repeat(el.rating) + '☆'.repeat(5 - el.rating);
    document.getElementById('tooltip-guide').textContent = el.guide;

    const body = document.getElementById('tooltip-body');
    body.textContent = '';

    const sections = [
      { title: 'メリット', items: el.tooltip.merit, cls: 'merit' },
      { title: 'デメリット', items: el.tooltip.demerit, cls: 'demerit' },
      { title: '相性の良い究極武器', items: el.tooltip.weapons, cls: 'future' },
      { title: '相性の良いドローン', items: el.tooltip.drones, cls: 'future' },
    ];

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (!sec.items || sec.items.length === 0) continue;

      const h = document.createElement('div');
      h.className = 'tooltip-section ' + sec.cls;
      h.textContent = sec.title;
      body.appendChild(h);

      const ul = document.createElement('ul');
      ul.className = 'tooltip-list';
      for (let k = 0; k < sec.items.length; k++) {
        const li = document.createElement('li');
        li.textContent = sec.items[k];
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    box.classList.remove('hidden');
  }

  /** 属性専用研究の1行 */
  buildResearchRow(el, r) {
    const g = this.game;
    const lv = g.elementResearchLevel(r.id);
    const maxed = lv >= r.maxLevel;
    const cost = Math.floor(r.baseCost * Math.pow(r.growth, lv));

    const row = document.createElement('div');
    row.className = 'el-res-row';

    const info = document.createElement('div');
    info.className = 'el-res-info';
    const n = document.createElement('div');
    n.className = 'el-res-name';
    n.textContent = r.name;
    const v = document.createElement('div');
    v.className = 'el-res-val';
    v.textContent = r.unit + ' +' + (r.per * lv * 100).toFixed(0) + '%  (Lv ' + lv + '/' + r.maxLevel + ')';
    info.appendChild(n);
    info.appendChild(v);

    const btn = document.createElement('button');
    btn.className = 'el-res-btn';
    if (maxed) {
      btn.textContent = 'MAX';
      btn.classList.add('disabled');
    } else {
      btn.textContent = formatNumber(cost) + '◎';
      if (g.meta.coin < cost) btn.classList.add('disabled');
      btn.addEventListener('click', () => {
        g.sfx.unlock();
        if (g.buyElementResearch(el, r)) {
          g.sfx.research();
        } else {
          g.sfx.deny();
        }
        this.build();
      });
    }

    row.appendChild(info);
    row.appendChild(btn);
    return row;
  }
}

/* =========================================================
 * 9.6 実績パネル（ACHIEVEMENTS配列から自動生成）
 * ======================================================= */

class Achievements {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('achievements-panel');
    this.listEl = document.getElementById('achievements-list');
    this.progressEl = document.getElementById('achievements-progress');
    this.isOpen = false;

    document.getElementById('btn-achievements')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-achievements-close')
      .addEventListener('click', () => this.close());
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
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

    let done = 0;
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      if (g.meta.achievements[ACHIEVEMENTS[i].id]) done++;
    }
    this.progressEl.textContent = done + ' / ' + ACHIEVEMENTS.length;

    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      const unlocked = !!g.meta.achievements[a.id];

      const root = document.createElement('div');
      root.className = 'achievement-item' + (unlocked ? ' unlocked' : '');

      const mark = document.createElement('div');
      mark.className = 'achievement-mark';
      mark.textContent = unlocked ? '★' : '☆';

      const info = document.createElement('div');
      info.className = 'achievement-info';

      const name = document.createElement('div');
      name.className = 'achievement-name';
      name.textContent = a.name;

      const desc = document.createElement('div');
      desc.className = 'achievement-desc';
      desc.textContent = a.desc;

      info.appendChild(name);
      info.appendChild(desc);

      const reward = document.createElement('div');
      reward.className = 'achievement-reward';
      reward.textContent = a.coin + '◎' + (a.gem > 0 ? ' ' + a.gem + '◆' : '');

      root.appendChild(mark);
      root.appendChild(info);
      root.appendChild(reward);
      this.listEl.appendChild(root);
    }
  }
}

/* =========================================================
 * 9.7 設定パネル
 * ======================================================= */

class Settings {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('settings-panel');
    this.statsEl = document.getElementById('settings-stats');
    this.isOpen = false;
    this.resetArmed = false;

    document.getElementById('btn-settings')
      .addEventListener('click', () => this.toggle());
    document.getElementById('btn-settings-close')
      .addEventListener('click', () => this.close());

    this.soundBtn = document.getElementById('btn-toggle-sound');
    this.soundBtn.addEventListener('click', () => {
      game.sfx.unlock();
      const on = !game.sfx.enabled;
      game.sfx.setEnabled(on);
      game.meta.soundOn = on;
      game.requestSave();
      game.flushSave();
      this.refresh();
    });

    // ---- Phase 5-A②: 表示・サウンド・端末の各設定 ----
    const g = game;
    const persist = () => { g.requestSave(); g.flushSave(); this.refresh(); };
    const toggleMeta = (key, apply) => {
      g.sfx.buy();
      g.meta[key] = !(g.meta[key] !== false);   // true<->false（既定true）
      if (apply) apply(g.meta[key]);
      persist();
    };

    // 表示倍率（Zoom）ステッパー
    this.zoomVal = document.getElementById('zoom-val');
    const ZOOM_STEPS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
    const shiftZoom = (dir) => {
      let idx = ZOOM_STEPS.indexOf(Math.round((g.meta.zoom || 1) * 10) / 10);
      if (idx < 0) idx = 3;
      const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir));
      if (next === idx) { g.sfx.deny(); return; }
      g.meta.zoom = ZOOM_STEPS[next];
      g.sfx.buy();
      g.renderFrame();
      persist();
    };
    document.getElementById('btn-zoom-dec').addEventListener('click', () => shiftZoom(-1));
    document.getElementById('btn-zoom-inc').addEventListener('click', () => shiftZoom(1));

    // トグル系
    this.damageBtn = document.getElementById('btn-toggle-damage');
    this.damageBtn.addEventListener('click', () => toggleMeta('showDamage'));
    this.enemyHpBtn = document.getElementById('btn-toggle-enemyhp');
    this.enemyHpBtn.addEventListener('click', () => toggleMeta('showEnemyHp'));

    this.bgmBtn = document.getElementById('btn-toggle-bgm');
    this.bgmBtn.addEventListener('click', () => {
      g.sfx.unlock();
      const on = !(g.meta.bgmOn !== false);
      g.meta.bgmOn = on;
      g.sfx.setBgmEnabled(on);
      if (on && g.running) g.sfx.startBgm(); else if (!on) g.sfx.stopBgm();
      g.sfx.buy();
      persist();
    });

    this.vibrationBtn = document.getElementById('btn-toggle-vibration');
    this.vibrationBtn.addEventListener('click', () => {
      toggleMeta('vibrationOn');
      if (g.meta.vibrationOn) g.vibrate(20);
    });

    this.fpsBtn = document.getElementById('btn-toggle-fps');
    this.fpsBtn.addEventListener('click', () => {
      toggleMeta('showFps', () => g.applyDisplaySettings());
    });

    // サイクル系（高→中→低）
    this.fxQualityBtn = document.getElementById('btn-cycle-fxquality');
    this.fxQualityBtn.addEventListener('click', () => {
      const order = ['high', 'med', 'low'];
      const i = order.indexOf(g.meta.fxQuality);
      g.meta.fxQuality = order[(i + 1) % order.length];
      g.sfx.buy();
      g.applyDisplaySettings();
      persist();
    });
    this.renderScaleBtn = document.getElementById('btn-cycle-renderscale');
    this.renderScaleBtn.addEventListener('click', () => {
      const order = ['high', 'med', 'low'];
      const i = order.indexOf(g.meta.renderScale);
      g.meta.renderScale = order[(i + 1) % order.length];
      g.sfx.buy();
      g.applyDisplaySettings();
      persist();
    });

    // 戦闘中: ホームへ戻る（リタイア） 2段階確認
    this.retreatBtn = document.getElementById('btn-retreat-home');
    this.retreatHint = document.getElementById('retreat-hint');
    this.retreatArmed = false;
    this.retreatBtn.addEventListener('click', () => {
      if (!this.retreatArmed) {
        this.retreatArmed = true;
        this.retreatBtn.textContent = '本当にホームへ戻る（周回をリタイア）';
        this.retreatBtn.classList.add('danger-armed');
        return;
      }
      g.sfx.buy();
      this.close();
      g.retreatToHome();
    });

    this.resetBtn = document.getElementById('btn-reset-save');
    this.resetBtn.addEventListener('click', () => this.onResetClick());

    // 開発者メニュー（FPS表示の7回タップで解放）
    this.devBox = document.getElementById('dev-box');
    document.querySelectorAll('.dev-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        game.devGrant(btn.dataset.dev);
        game.showToast('開発者: ' + btn.textContent, 1600);
        this.refresh();
      });
    });

    // 開始Wave の選択（研究「戦域転送」で解放した範囲内）
    this.startWaveVal = document.getElementById('start-wave-val');
    this.startWaveHint = document.getElementById('start-wave-hint');
    document.getElementById('btn-start-wave-dec')
      .addEventListener('click', () => this.shiftStartWave(-1));
    document.getElementById('btn-start-wave-inc')
      .addEventListener('click', () => this.shiftStartWave(1));
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.game.closePanels(this);
    this.isOpen = true;
    this.panel.classList.remove('closed');
    // 戦闘中に設定を開いている間は一時停止する
    if (this.game.screenState === 'battle') this.game.setPaused(true);
    this.refresh();
  }
  close() {
    this.isOpen = false;
    this.panel.classList.add('closed');
    this.disarmReset();
    this.disarmRetreat();
    if (this.game.screenState === 'battle') this.game.setPaused(false);
  }

  disarmRetreat() {
    this.retreatArmed = false;
    if (this.retreatBtn) {
      this.retreatBtn.textContent = '⌂ ホームに戻る（リタイア）';
      this.retreatBtn.classList.remove('danger-armed');
    }
  }

  /** 開始Waveを増減。上限は研究で解放した値 */
  shiftStartWave(delta) {
    const g = this.game;
    const max = Math.max(1, g.player.stats.startWave);
    const next = Math.max(1, Math.min(g.meta.selectedStartWave + delta, max));
    if (next === g.meta.selectedStartWave) {
      g.sfx.deny();
      return;
    }
    g.meta.selectedStartWave = next;
    g.sfx.buy();
    g.requestSave();
    g.flushSave();
    this.refresh();
  }

  disarmReset() {
    this.resetArmed = false;
    this.resetBtn.textContent = 'セーブデータを初期化';
    this.resetBtn.classList.remove('danger-armed');
  }

  /** 誤操作防止のため2段階確認にする */
  onResetClick() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetBtn.textContent = '本当に初期化する（取り消し不可）';
      this.resetBtn.classList.add('danger-armed');
      return;
    }
    const g = this.game;
    g.saveManager.clear();
    g.meta = SaveManager.defaultMeta();
    g.discovered = new Set();
    g.killsByType = g.meta.codexKills;
    g.applyMetaToResearch();
    g.applyMetaToLab();
    g.player.recalc();
    g.showToast('セーブデータを初期化しました');
    this.disarmReset();
    this.refresh();
    g.hudDirty = true;
  }

  refresh() {
    const g = this.game;
    const m = g.meta;

    this.soundBtn.textContent = 'SE: ' + (g.sfx.enabled ? 'ON' : 'OFF');
    this.soundBtn.classList.toggle('off', !g.sfx.enabled);
    this.devBox.classList.toggle('hidden', !g.meta.devMode);

    // 表示・サウンド・端末トグルの表示反映
    const onoff = (v) => (v !== false) ? 'ON' : 'OFF';
    const qLabel = (v) => v === 'low' ? '低' : (v === 'med' ? '中' : '高');
    if (this.zoomVal) this.zoomVal.textContent = Math.round((g.meta.zoom || 1) * 100) + '%';
    if (this.damageBtn) {
      this.damageBtn.textContent = 'ダメージ数字: ' + onoff(g.meta.showDamage);
      this.damageBtn.classList.toggle('off', g.meta.showDamage === false);
    }
    if (this.enemyHpBtn) {
      this.enemyHpBtn.textContent = '敵HPバー: ' + onoff(g.meta.showEnemyHp);
      this.enemyHpBtn.classList.toggle('off', g.meta.showEnemyHp === false);
    }
    if (this.fxQualityBtn) this.fxQualityBtn.textContent = 'エフェクト品質: ' + qLabel(g.meta.fxQuality);
    if (this.renderScaleBtn) this.renderScaleBtn.textContent = '画質: ' + qLabel(g.meta.renderScale);
    if (this.bgmBtn) {
      this.bgmBtn.textContent = 'BGM: ' + onoff(g.meta.bgmOn);
      this.bgmBtn.classList.toggle('off', g.meta.bgmOn === false);
    }
    if (this.vibrationBtn) {
      this.vibrationBtn.textContent = '振動: ' + onoff(g.meta.vibrationOn);
      this.vibrationBtn.classList.toggle('off', g.meta.vibrationOn === false);
    }
    if (this.fpsBtn) {
      this.fpsBtn.textContent = 'FPS表示: ' + (g.meta.showFps ? 'ON' : 'OFF');
      this.fpsBtn.classList.toggle('off', !g.meta.showFps);
    }

    // 戦闘中のみ「ホームに戻る（リタイア）」を表示
    const inBattle = g.screenState === 'battle';
    if (this.retreatBtn) this.retreatBtn.classList.toggle('hidden', !inBattle);
    if (this.retreatHint) this.retreatHint.classList.toggle('hidden', !inBattle);

    const maxStart = Math.max(1, g.player.stats.startWave);
    if (g.meta.selectedStartWave > maxStart) g.meta.selectedStartWave = maxStart;
    this.startWaveVal.textContent = 'Wave ' + g.meta.selectedStartWave;
    this.startWaveHint.textContent = maxStart > 1
      ? '研究により Wave ' + maxStart + ' まで解放済み（次の周回から反映）'
      : '研究「戦域転送」で解放されます';

    const h = Math.floor(m.playTime / 3600);
    const min = Math.floor((m.playTime % 3600) / 60);
    const rows = [
      ['最高到達 Wave', formatNumber(m.bestWave)],
      ['累計撃破数', formatNumber(m.totalKills)],
      ['ボス撃破数', formatNumber(m.bossKills)],
      ['プレイ回数', formatNumber(m.totalRuns)],
      ['最高所持 Cash', '$' + formatNumber(m.maxCash)],
      ['プレイ時間', h + '時間 ' + min + '分'],
      ['保存先', g.saveManager.available ? 'ブラウザに保存中' : '保存不可（一時データ）'],
    ];

    this.statsEl.textContent = '';
    for (let i = 0; i < rows.length; i++) {
      const row = document.createElement('div');
      row.className = 'settings-row';
      const k = document.createElement('span');
      k.className = 'settings-key';
      k.textContent = rows[i][0];
      const v = document.createElement('span');
      v.className = 'settings-val';
      v.textContent = rows[i][1];
      row.appendChild(k);
      row.appendChild(v);
      this.statsEl.appendChild(row);
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
    this.lightnings = [];
    this.blackholes = [];

    // プール
    this.enemyPool = new Pool(() => new Enemy(), 80);
    this.projectilePool = new Pool(() => new Projectile(), 80);
    this.enemyProjectilePool = new Pool(() => new EnemyProjectile(), 40);
    this.particlePool = new Pool(() => new Particle(), 400);
    this.damageNumberPool = new Pool(() => new DamageNumber(), 80);
    this.minePool = new Pool(() => new Mine(), 16);
    this.shockwavePool = new Pool(() => new Shockwave(), 24);
    this.packagePool = new Pool(() => new Package(), 16);

    // ---- 永続データの復元 ----
    this.saveManager = new SaveManager();
    this.meta = this.saveManager.load();
    this.saveDirty = false;
    this.autoSaveTimer = 0;
    this.applyMetaToResearch();
    this.applyMetaToLab();

    // 図鑑・実績は永続データを参照する
    this.discovered = new Set(this.meta.discovered);
    this.killsByType = this.meta.codexKills;

    // 通貨・周回内の記録
    this.cash = 0;
    this.coinFrac = 0;
    this.runKills = 0;
    this.runBossKills = 0;

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
    this.research = new Research(this);
    this.lab = new Lab(this);
    this.modules = new Modules(this);
    this.gacha = new Gacha(this);
    this.elements = new Elements(this);
    this.achievements = new Achievements(this);
    this.settings = new Settings(this);
    this.panelList = [
      this.shop, this.codex, this.research, this.lab,
      this.modules, this.gacha, this.elements,
      this.achievements, this.settings,
    ];
    this.bindEvents();

    // 保存されていたサウンド設定・ゲームスピードを復元
    this.sfx.setEnabled(this.meta.soundOn !== false);
    this.sfx.setBgmEnabled(this.meta.bgmOn !== false);
    this.applyDisplaySettings();
    this.gameSpeed = GAME_SPEEDS.indexOf(this.meta.gameSpeed) >= 0
      ? this.meta.gameSpeed
      : 1;
    this.hud.speedVal.textContent = '×' + this.gameSpeed;

    // 既に到達済みのTierは演出なしで解放済みにしておく
    for (let i = 0; i < UPGRADE_TIERS.length; i++) {
      const t = UPGRADE_TIERS[i];
      if (this.meta.bestWave >= t.requiredWave) this.meta.unlockedTiers[t.tier] = true;
    }
    this.shop.buildList();

    // 旧仕様（Wave到達で自動解放）からの移行処理
    this.migrateElementUnlocks();

    // 未解放の属性が選ばれていたらニュートラルへ戻す
    if (!this.isElementUnlocked(this.meta.activeElement)) {
      this.meta.activeElement = 'none';
      this.meta.pendingElement = 'none';
    }
    this.player.recalc();

    // 閉じている間に完了した研究を回収してから報酬を計算する。
    // 回収処理がセーブを走らせるので、離脱時刻は先に控えておく。
    const lastExitAtBoot = this.meta.lastExit;
    this.offlineLabDone = this.processLabJobs(true);

    // オフライン報酬の判定（完了した研究の効果も反映された状態で計算する）
    this.pendingOffline = this.calcOfflineReward(lastExitAtBoot);
    this.resize();
    this.renderFrame();

    this._loop = this.loop.bind(this);

    // 起動直後はタイトル画面（音声解放のためのタップを待つ）
    this.screenState = 'title';
    this.setScreenState('title');
  }

  cacheHudElements() {
    const $ = (id) => document.getElementById(id);
    return {
      cash: $('val-cash'),
      cashItem: document.querySelector('.currency-cash'),
      coin: $('val-coin'),
      gem: $('val-gem'),
      frag: $('val-frag'),
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
      speedBtn: $('btn-speed'),
      heatWrap: $('heat-wrap'),
      coreUnlock: $('overlay-core-unlock'),
      heatFill: $('heat-fill'),
      heatLabel: $('heat-label'),
      elementBadge: $('element-badge'),
      speedVal: $('val-speed'),
      offlineOverlay: $('overlay-offline'),
      offlineTime: $('offline-time'),
      offlineCash: $('offline-cash'),
      offlineCoin: $('offline-coin'),
      offlineGem: $('offline-gem'),
      offlineGemRow: $('offline-gem-row'),
      overlayStart: $('overlay-start'),
      overlayGameOver: $('overlay-gameover'),
      goWave: $('go-wave'),
      goKills: $('go-kills'),
      goCoin: $('go-coin'),
      goCash: $('go-cash'),
      goGem: $('go-gem'),
      goCrit: $('go-crit'),
      goOverclock: $('go-overclock'),
      // ホーム画面
      overlayHome: $('overlay-home'),
      homeCoin: $('home-coin'),
      homeGem: $('home-gem'),
      homeFrag: $('home-frag'),
      homeElement: $('home-element'),
      homeLevel: $('home-level'),
      homeVersion: $('home-version'),
      homePlaytime: $('home-playtime'),
    };
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    // タイトル「起動する」→ 音声解放してホーム画面へ
    document.getElementById('btn-start')
      .addEventListener('click', () => { this.sfx.unlock(); this.bootToHome(); });
    // ホーム「START」→ 現在の装備・属性・研究を読み込んで出撃
    document.getElementById('btn-home-start')
      .addEventListener('click', () => { this.sfx.unlock(); this.enterBattle(); });
    // ゲームオーバー画面 → ホームへ戻る
    document.getElementById('btn-restart')
      .addEventListener('click', () => { this.sfx.unlock(); this.returnToHome(); });

    // ホーム画面のメニュータイル
    const homeActions = {
      lab: () => this.lab.open(),
      research: () => this.research.open(),
      elements: () => this.elements.open(),
      modules: () => this.modules.open(),
      gacha: () => this.gacha.open(),
      codex: () => this.codex.open(),
      achievements: () => this.achievements.open(),
      settings: () => this.settings.open(),
      // Ver1.0で実装予定
      ultimate: () => this.showToast('Ver1.0で実装予定'),
      drone: () => this.showToast('Ver1.0で実装予定'),
      daily: () => this.showToast('Ver1.0で実装予定'),
    };
    document.querySelectorAll('#overlay-home [data-home]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = homeActions[btn.dataset.home];
        if (!action) return;
        this.sfx.unlock();
        this.sfx.buy();
        action();
      });
    });

    // 戦闘中の属性クイック情報（属性バッジのタップで表示）
    const badge = document.getElementById('element-badge');
    if (badge) {
      badge.classList.add('tappable');
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleElementQuickInfo();
      });
    }
    document.addEventListener('click', (e) => {
      const qi = document.getElementById('element-quickinfo');
      if (!qi || qi.classList.contains('hidden')) return;
      if (e.target.closest('#element-quickinfo') || e.target.closest('#element-badge')) return;
      qi.classList.add('hidden');
    });

    this.hud.speedBtn.addEventListener('click', () => this.cycleGameSpeed());

    // 開発者モード: FPS表示を3秒以内に7回タップすると解放される
    this._devTaps = 0;
    this._devTapTime = 0;
    this.hud.fps.addEventListener('click', () => this.onDevTap());

    document.getElementById('btn-offline-close')
      .addEventListener('click', () => {
        this.hud.offlineOverlay.classList.add('hidden');
      });

    document.querySelectorAll('.menu-btn-locked').forEach((btn) => {
      btn.addEventListener('click', () => this.showToast(btn.dataset.locked));
    });

    // タブ非アクティブ時はBGMを止めて負荷を下げる
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sfx.stopBgm();
        this.flushSave();   // タブを離れる際に取りこぼさず保存
      } else if (this.running) {
        this.sfx.startBgm();
      }
    });
    window.addEventListener('pagehide', () => this.flushSave());
  }

  /** 指定パネル以外を閉じる */
  closePanels(except) {
    if (!this.panelList) return;
    for (let i = 0; i < this.panelList.length; i++) {
      const p = this.panelList[i];
      if (p !== except) p.close();
    }
  }

  /* ---------- モジュール ---------- */

  moduleByUid(uid) {
    const list = this.meta.modules;
    for (let i = 0; i < list.length; i++) {
      if (list[i].uid === uid) return list[i];
    }
    return null;
  }

  /** 装備中モジュールの配列（未装備の枠は含めない） */
  equippedModules() {
    if (!this.meta || !this.meta.equipped) return null;
    const out = [];
    for (let i = 0; i < MODULE_TYPES.length; i++) {
      const uid = this.meta.equipped[MODULE_TYPES[i].id];
      if (!uid) continue;
      const m = this.moduleByUid(uid);
      if (m) out.push(m);
    }
    return out;
  }

  equipModule(mod) {
    const bp = blueprintById(mod.bp);
    if (!bp) return false;
    this.meta.equipped[bp.type] = mod.uid;
    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.checkAchievements();
    this.hudDirty = true;
    return true;
  }

  unequipModule(typeId) {
    delete this.meta.equipped[typeId];
    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
  }

  /** モジュールを分解してシャードにする */
  dismantleModule(mod) {
    const bp = blueprintById(mod.bp);
    if (bp && this.meta.equipped[bp.type] === mod.uid) return false;

    const idx = this.meta.modules.indexOf(mod);
    if (idx === -1) return false;
    this.meta.modules.splice(idx, 1);

    // レベルに投入したぶんの一部も戻す
    let refund = moduleShardValue(mod.rarity);
    for (let l = 0; l < mod.level; l++) {
      refund += Math.floor(moduleUpgradeCost(mod.rarity, l) * 0.5);
    }
    this.meta.shards += refund;
    this.requestSave();
    this.flushSave();
    return refund;
  }

  /** シャードを消費してモジュールを強化する */
  upgradeModule(mod) {
    if (mod.level >= MODULE_MAX_LEVEL) return false;
    const cost = moduleUpgradeCost(mod.rarity, mod.level);
    if (this.meta.shards < cost) return false;

    this.meta.shards -= cost;
    mod.level++;
    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.checkAchievements();
    this.hudDirty = true;
    return true;
  }

  /* ---------- ガチャ ---------- */

  /**
   * ガチャを1回分抽選する。minRarityIndex を指定するとその下限を保証する。
   * 戻り値は表示用の結果オブジェクト。
   */
  rollGachaOnce(minRarityIndex) {
    const kind = weightedPick(GACHA_KINDS).kind;
    const rarity = rollRarity(minRarityIndex);

    if (kind === 'skin') {
      // そのレアリティのスキンを引く。所持済みならシャードへ変換
      const candidates = SKINS.filter((sk) => sk.rarity === rarity.id);
      if (candidates.length > 0) {
        const sk = candidates[Math.floor(Math.random() * candidates.length)];
        if (this.meta.skins.indexOf(sk.id) === -1) {
          this.meta.skins.push(sk.id);
          return { kind: 'skin', rarity: rarity.id, skin: sk, duplicate: false };
        }
        const shards = moduleShardValue(rarity.id);
        this.meta.shards += shards;
        return { kind: 'skin', rarity: rarity.id, skin: sk, duplicate: true, shards };
      }
    }

    // モジュール
    const bp = MODULE_BLUEPRINTS[
      Math.floor(Math.random() * MODULE_BLUEPRINTS.length)
    ];
    const mod = createModule(bp, rarity.id);

    // 所持上限に達している場合はシャードへ自動変換する
    if (this.meta.modules.length >= MODULE_INVENTORY_MAX) {
      const shards = moduleShardValue(rarity.id);
      this.meta.shards += shards;
      return {
        kind: 'module', rarity: rarity.id, module: mod, blueprint: bp,
        overflow: true, shards,
      };
    }

    this.meta.modules.push(mod);
    return { kind: 'module', rarity: rarity.id, module: mod, blueprint: bp };
  }

  /** ガチャを引く。count は 1 か GACHA_MULTI_COUNT */
  pullGacha(count) {
    const cost = count === 1 ? GACHA_SINGLE_COST : GACHA_MULTI_COST;
    if (this.meta.gem < cost) return null;

    this.meta.gem -= cost;
    const results = [];
    for (let i = 0; i < count; i++) {
      // 10連は最後の1枠が Rare 以上確定
      const guarantee = count > 1 && i === count - 1 ? 1 : 0;
      results.push(this.rollGachaOnce(guarantee));
    }
    this.meta.gachaPulls += count;

    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    this.checkAchievements();
    return results;
  }

  /* ---------- スキン ---------- */

  setSkin(id) {
    if (this.meta.skins.indexOf(id) === -1) return false;
    this.meta.activeSkin = id;
    this.requestSave();
    this.flushSave();
    return true;
  }

  activeSkin() {
    return skinById(this.meta.activeSkin);
  }

  /* ---------- LAB（実時間研究） ---------- */

  /** セーブデータのレベルを LAB_RESEARCH 配列へ反映 */
  applyMetaToLab() {
    for (let i = 0; i < LAB_RESEARCH.length; i++) {
      const r = LAB_RESEARCH[i];
      const saved = this.meta.labLevels[r.id];
      r.level = typeof saved === 'number'
        ? Math.max(0, Math.min(saved, r.maxLevel))
        : 0;
    }
  }

  syncLabToMeta() {
    for (let i = 0; i < LAB_RESEARCH.length; i++) {
      const r = LAB_RESEARCH[i];
      this.meta.labLevels[r.id] = r.level;
    }
  }

  labById(id) {
    for (let i = 0; i < LAB_RESEARCH.length; i++) {
      if (LAB_RESEARCH[i].id === id) return LAB_RESEARCH[i];
    }
    return null;
  }

  /** 指定研究が進行中ならジョブを返す */
  labJobOf(id) {
    const jobs = this.meta.labJobs;
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].id === id) return jobs[i];
    }
    return null;
  }

  /**
   * 完了時刻を過ぎたジョブを回収する。
   * 起動時にも呼ばれるため、ゲームを閉じている間の進行もここで反映される。
   * 戻り値は完了した研究の配列。
   */
  processLabJobs(silent) {
    const now = Date.now();
    const jobs = this.meta.labJobs;
    const done = [];

    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].endsAt > now) continue;
      const job = jobs.splice(i, 1)[0];
      const r = this.labById(job.id);
      if (!r) continue;
      // 保存されたレベルより低い完了は無視（多重適用の防止）
      if (r.level >= job.level) continue;
      r.level = job.level;
      done.push(r);
    }

    if (done.length === 0) return done;

    this.syncLabToMeta();
    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;

    if (!silent) {
      const names = done.map((r) => r.name + ' Lv' + r.level).join(' / ');
      this.showToast('研究完了: ' + names, 3200);
      this.sfx.research();
      this.flashScreen(0.18, '#a561ff');
    }
    if (this.lab && this.lab.isOpen) this.lab.build();
    return done;
  }

  /** 空きスロットがあるか */
  labFreeSlots() {
    return this.meta.labSlots - this.meta.labJobs.length;
  }

  /** 研究に着手する。成功で true */
  startLabJob(r) {
    if (r.level >= r.maxLevel) return false;
    if (!this.isUnlocked(r)) return false;
    if (this.labJobOf(r.id)) return false;
    if (this.labFreeSlots() <= 0) return false;

    const cost = labCostAt(r, r.level);
    if (this.meta.coin < cost) return false;

    this.meta.coin -= cost;
    const duration = labDurationAt(r, r.level);
    this.meta.labJobs.push({
      id: r.id,
      level: r.level + 1,
      endsAt: Date.now() + duration * 1000,
    });
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /** Gemを支払って研究を即時完了させる */
  rushLabJob(job) {
    const remaining = Math.max(0, (job.endsAt - Date.now()) / 1000);
    const cost = labSpeedupGemCost(remaining);
    if (this.meta.gem < cost) return false;

    this.meta.gem -= cost;
    job.endsAt = Date.now();
    this.processLabJobs(false);
    return true;
  }

  /** Gemで研究スロットを増やす */
  buyLabSlot() {
    const next = this.meta.labSlots;
    if (next >= LAB_SLOT_COSTS.length) return false;
    const cost = LAB_SLOT_COSTS[next];
    if (this.meta.gem < cost) return false;

    this.meta.gem -= cost;
    this.meta.labSlots++;
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /* ---------- Gem 獲得 ---------- */

  /** 高Wave到達の節目でGemを支払う */
  checkGemMilestones() {
    let total = 0;
    let frag = 0;
    for (let i = 0; i < GEM_MILESTONES.length; i++) {
      const m = GEM_MILESTONES[i];
      if (this.meta.bestWave < m.wave) continue;
      if (this.meta.gemMilestones[m.wave]) continue;
      this.meta.gemMilestones[m.wave] = true;
      total += m.gem;
      frag += m.frag || 0;
    }
    if (frag > 0) this.addFragments(frag, true);
    if (total <= 0 && frag <= 0) return;

    const amount = Math.floor(total * this.player.stats.gemFindMul);
    this.meta.gem += amount;
    const parts = [];
    if (amount > 0) parts.push('+' + amount + ' ◆');
    if (frag > 0) parts.push('+' + frag + ' ◆◆');
    this.showToast('到達報酬  ' + parts.join(' / '), 3000);
    this.sfx.achievement();
    this.flashScreen(0.2, '#ff2d95');
    this.requestSave();
    this.hudDirty = true;
  }

  /** 広告視聴（ダミー実装）でGemを得る。1日3回まで */
  watchAd() {
    const today = new Date().toDateString();
    if (this.meta.adDate !== today) {
      this.meta.adDate = today;
      this.meta.adCount = 0;
    }
    if (this.meta.adCount >= 3) return 0;

    this.meta.adCount++;
    const amount = Math.floor(5 * this.player.stats.gemFindMul);
    this.meta.gem += amount;
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return amount;
  }

  adRemainingToday() {
    const today = new Date().toDateString();
    if (this.meta.adDate !== today) return 3;
    return Math.max(0, 3 - this.meta.adCount);
  }

  /* ---------- アップグレード解放 ---------- */

  /** 到達Waveに応じて新しいTierを解放し、初回のみ演出を出す */
  checkTierUnlocks() {
    const best = this.meta.bestWave;
    let newest = null;

    for (let i = 0; i < UPGRADE_TIERS.length; i++) {
      const t = UPGRADE_TIERS[i];
      if (best < t.requiredWave) continue;
      if (this.meta.unlockedTiers[t.tier]) continue;
      this.meta.unlockedTiers[t.tier] = true;
      if (t.requiredWave > 0) newest = t;
    }

    if (!newest) return;

    // 解放演出: 効果音・画面フラッシュ・通知・ショップ側の点滅
    this.sfx.unlockTier();
    this.flashScreen(0.3, '#ffc233');
    this.shakeScreen(6);
    const nUp = UPGRADES.filter((u) => u.tier === newest.tier).length;
    const nRe = RESEARCH.filter((r) => r.tier === newest.tier).length;
    const nLab = LAB_RESEARCH.filter((r) => r.tier === newest.tier).length;
    const parts = [];
    if (nUp > 0) parts.push('強化' + nUp + '種');
    if (nRe > 0) parts.push('研究' + nRe + '種');
    if (nLab > 0) parts.push('LAB' + nLab + '種');
    this.showToast(
      'TIER ' + newest.tier + ' 解放！  ' + parts.join(' / '), 3200
    );
    this.shop.markTierUnlocked(newest.tier);
    if (this.research.isOpen) this.research.build();
    if (this.lab.isOpen) this.lab.build();
    this.requestSave();
  }

  /** 指定アップグレードが解放済みか */
  isUnlocked(u) {
    return this.meta.bestWave >= requiredWaveOf(u);
  }

  /* ---------- ゲームスピード ---------- */

  setGameSpeed(mul) {
    this.gameSpeed = mul;
    this.meta.gameSpeed = mul;
    this.hud.speedVal.textContent = '×' + mul;
    this.requestSave();
  }

  cycleGameSpeed() {
    const idx = GAME_SPEEDS.indexOf(this.gameSpeed);
    this.setGameSpeed(GAME_SPEEDS[(idx + 1) % GAME_SPEEDS.length]);
    this.sfx.unlock();
    this.sfx.buy();
  }

  /* ---------- オフライン報酬 ---------- */

  /**
   * 前回終了からの経過時間に応じた報酬を計算する。
   * 到達Waveが高いほど効率が上がる。上限は OFFLINE_MAX_HOURS。
   */
  calcOfflineReward(since) {
    // 起動時は processLabJobs のセーブで meta.lastExit が現在時刻へ
    // 更新されてしまうため、読み込み直後に控えた値を引数で受け取る。
    const last = since === undefined ? this.meta.lastExit : since;
    if (!last) return null;

    const elapsedMs = Date.now() - last;
    const minutes = elapsedMs / 60000;
    if (minutes < CONFIG.OFFLINE_MIN_MINUTES) return null;

    const capped = Math.min(minutes, CONFIG.OFFLINE_MAX_HOURS * 60);
    const wave = Math.max(this.meta.bestWave, 1);

    // LAB「自律運転」で効率が上がる
    const mul = this.player.stats.offlineMul;

    return {
      minutes: capped,
      cash: Math.floor(capped * (12 + wave * 2.5) * mul),
      coin: Math.floor(capped * (0.05 + wave * 0.004) * mul),
      gem: Math.floor(capped / 120) * (wave >= 50 ? 1 : 0),
    };
  }

  grantOfflineReward(r) {
    this.meta.pendingCash += r.cash;
    this.meta.coin += r.coin;
    this.meta.gem += r.gem;
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
  }

  /* ---------- 永続データ ---------- */

  /** セーブデータの研究レベルを RESEARCH 配列へ反映 */
  applyMetaToResearch() {
    for (let i = 0; i < RESEARCH.length; i++) {
      const r = RESEARCH[i];
      const saved = this.meta.research[r.id];
      r.level = typeof saved === 'number'
        ? Math.max(0, Math.min(saved, r.maxLevel))
        : 0;
    }
  }

  /** RESEARCH 配列の状態を meta へ書き戻す */
  syncResearchToMeta() {
    for (let i = 0; i < RESEARCH.length; i++) {
      const r = RESEARCH[i];
      this.meta.research[r.id] = r.level;
    }
  }

  requestSave() { this.saveDirty = true; }

  /**
   * 変更があればセーブする。
   * force を渡すと変更フラグに関係なく必ず書き込む。
   */
  flushSave(force) {
    if (!this.saveDirty && !force) return;
    this.saveDirty = false;
    this.meta.lastExit = Date.now();
    this.meta.discovered = [...this.discovered];
    this.syncResearchToMeta();
    this.syncLabToMeta();
    this.saveManager.save(this.meta);
  }

  /** 実績判定に渡す統計スナップショット */
  buildAchievementContext() {
    const m = this.meta;
    return {
      totalKills: m.totalKills,
      bossKills: m.bossKills,
      bestWave: m.bestWave,
      bestWaveWithWall: m.bestWaveWithWall,
      maxCash: m.maxCash,
      totalRuns: m.totalRuns,
      discoveredCount: this.discovered.size,
      upgradeLevels: totalLevels(UPGRADES),
      researchLevels: totalLevels(RESEARCH),
      gachaPulls: m.gachaPulls || 0,
      equippedCount: Object.keys(m.equipped || {}).length,
      bestModuleRarity: this.bestModuleStat('rarity'),
      bestModuleLevel: this.bestModuleStat('level'),
    };
  }

  /** 所持モジュールの最高レアリティ／最高レベルを返す */
  bestModuleStat(kind) {
    const list = this.meta.modules || [];
    let best = 0;
    for (let i = 0; i < list.length; i++) {
      const v = kind === 'rarity'
        ? rarityIndex(list[i].rarity)
        : list[i].level;
      if (v > best) best = v;
    }
    return best;
  }

  /** 未解除の実績を判定し、達成していれば報酬を支払う */
  checkAchievements() {
    const ctx = this.buildAchievementContext();
    let unlocked = false;

    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      if (this.meta.achievements[a.id]) continue;
      if (!a.check(ctx)) continue;

      this.meta.achievements[a.id] = true;
      this.meta.coin += a.coin;
      this.meta.gem += a.gem;
      if (a.frag) this.meta.fragments += a.frag;
      unlocked = true;

      const reward = a.coin + '◎' +
        (a.gem > 0 ? ' / ' + a.gem + '◆' : '') +
        (a.frag ? ' / ' + a.frag + '◆◆' : '');
      this.showToast('実績解除: ' + a.name + '  +' + reward);
      this.sfx.achievement();
    }

    if (unlocked) {
      this.requestSave();
      this.hudDirty = true;
      if (this.achievements && this.achievements.isOpen) this.achievements.build();
    }
  }

  /* ---------- 属性コア ---------- */

  activeElement() {
    return elementById(this.meta.activeElement);
  }

  /** 指定属性の累計撃破数とレベル */
  elementExpOf(id) { return this.meta.elementExp[id] || 0; }

  /** 確定済みの属性レベル（Core Fragment を払って上げたもの） */
  elementLevelOf(id) {
    const lv = this.meta.elementLevel[id];
    const el = elementById(id);
    const max = el.expTable.length;
    if (typeof lv !== 'number' || lv < 1) return 1;
    return Math.min(lv, max);
  }

  /** 撃破数の条件を満たしていて、次のレベルへ上げられるか */
  canLevelUpElement(id) {
    const el = elementById(id);
    const lv = this.elementLevelOf(id);
    if (lv >= el.expTable.length) return { ok: false, reason: 'max' };
    if (!this.isElementUnlocked(id)) return { ok: false, reason: 'locked' };

    const needExp = el.expTable[lv];
    const cost = this.elementLevelCost(el, lv);
    if (this.elementExpOf(id) < needExp) {
      return { ok: false, reason: 'exp', needExp, cost };
    }
    if (this.meta.fragments < cost) {
      return { ok: false, reason: 'fragment', needExp, cost };
    }
    return { ok: true, needExp, cost };
  }

  elementLevelCost(el, level) {
    const table = el.levelCost || DEFAULT_LEVEL_COST;
    return table[level - 1] !== undefined
      ? table[level - 1]
      : table[table.length - 1];
  }

  /** Core Fragment を払って属性のレベルを上げる */
  levelUpElement(id) {
    const check = this.canLevelUpElement(id);
    if (!check.ok) return false;

    const el = elementById(id);
    this.meta.fragments -= check.cost;
    this.meta.elementLevel[id] = this.elementLevelOf(id) + 1;
    const after = this.elementLevelOf(id);

    this.player.recalc();
    this.sfx.elementLevelUp();
    this.flashScreen(0.22, el.color);
    this.showToast(
      el.name + ' コア Lv' + after + '  ' +
      (el.levelPerks[after - 1] ? el.levelPerks[after - 1].text : ''),
      3200
    );
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /* ---------- Core Fragment ---------- */

  /** 次に属性を1つ解放するのに必要な Core Fragment */
  nextUnlockCost() {
    // ニュートラルは最初から解放済みなので数に含めない
    let unlocked = 0;
    for (let i = 0; i < ELEMENTS.length; i++) {
      const el = ELEMENTS[i];
      if (el.id === 'none') continue;
      if (this.meta.elementsUnlocked[el.id]) unlocked++;
    }
    return ELEMENT_UNLOCK_COSTS[unlocked] !== undefined
      ? ELEMENT_UNLOCK_COSTS[unlocked]
      : ELEMENT_UNLOCK_COSTS[ELEMENT_UNLOCK_COSTS.length - 1];
  }

  addFragments(amount, silent) {
    if (amount <= 0) return;
    this.meta.fragments += amount;
    this.requestSave();
    this.hudDirty = true;
    if (!silent) {
      this.showToast('Core Fragment +' + amount + ' ◆◆', 2600);
      this.sfx.achievement();
    }
  }

  /** Core Fragment を払って属性を解放する */
  unlockElement(id) {
    if (this.isElementUnlocked(id)) return false;
    const cost = this.nextUnlockCost();
    if (this.meta.fragments < cost) return false;

    this.meta.fragments -= cost;
    this.meta.elementsUnlocked[id] = true;
    this.meta.elementLevel[id] = 1;
    this.showCoreUnlock(elementById(id));
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /**
   * 旧仕様（Wave到達で自動解放）からの移行。
   * 自動解放されていた属性は一度ロックへ戻し、
   * 相当する Core Fragment を返還して選び直せるようにする。
   */
  migrateElementUnlocks() {
    if (this.meta.elementMigrated) return;
    this.meta.elementMigrated = true;

    let refund = 0;
    let count = 0;
    for (let i = 0; i < ELEMENTS.length; i++) {
      const el = ELEMENTS[i];
      if (el.id === 'none') continue;
      if (!this.meta.elementsUnlocked[el.id]) continue;
      refund += ELEMENT_UNLOCK_COSTS[count] !== undefined
        ? ELEMENT_UNLOCK_COSTS[count]
        : ELEMENT_UNLOCK_COSTS[ELEMENT_UNLOCK_COSTS.length - 1];
      count++;
      delete this.meta.elementsUnlocked[el.id];
    }
    this.meta.elementsUnlocked.none = true;

    if (count > 0) {
      this.meta.fragments += refund;
      this.migrationNotice =
        '属性の解放方式が変わりました。Core Fragment ' + refund +
        ' 個を返還したので、好きな属性を選び直してください。';
    }

    // 旧仕様で経験値だけ持っている場合、レベルは1から選び直す
    if (!this.meta.activeElement || !this.meta.elementsUnlocked[this.meta.activeElement]) {
      this.meta.activeElement = 'none';
      this.meta.pendingElement = 'none';
    }
    this.requestSave();
  }

  /** computeResearchStats へ渡す属性の状態 */
  elementState(id) {
    const eid = id || this.meta.activeElement;
    return {
      level: this.elementLevelOf(eid),
      research: this.meta.elementResearch,
    };
  }

  /** 効果値のキャッシュを更新する（recalc から呼ばれる） */
  refreshElementParams() {
    const el = this.activeElement();
    const st = this.elementState();
    this.elParams = elementParams(el, st.level, st.research);
  }

  /** 属性が解放済みか */
  isElementUnlocked(id) {
    return !!this.meta.elementsUnlocked[id];
  }

  /** 進行状況に応じたおすすめ属性（強制ではなくガイド） */
  recommendedElement() {
    for (let i = 0; i < ELEMENT_RECOMMENDATIONS.length; i++) {
      const rec = ELEMENT_RECOMMENDATIONS[i];
      if (this.meta.bestWave < rec.minWave) continue;
      if (this.isElementUnlocked(rec.id)) continue;
      return rec;
    }
    return null;
  }

  /** 「NEW CORE UNLOCKED」の画面中央演出 */
  showCoreUnlock(el) {
    const o = this.hud.coreUnlock;
    document.getElementById('core-unlock-icon').textContent = el.icon;
    document.getElementById('core-unlock-icon').style.color = el.color;
    document.getElementById('core-unlock-name').textContent = el.name + ' CORE';
    document.getElementById('core-unlock-name').style.color = el.color;
    document.getElementById('core-unlock-desc').textContent = el.desc;
    o.classList.remove('hidden');

    this.sfx.coreUnlock();
    this.flashScreen(0.4, el.color);
    this.shakeScreen(10);
    if (this.elements.isOpen) this.elements.build();

    if (this._coreUnlockTimer) clearTimeout(this._coreUnlockTimer);
    this._coreUnlockTimer = setTimeout(() => o.classList.add('hidden'), 4200);
  }

  /**
   * 撃破時に使用中の属性へ経験値を与える。
   * レベルが上がったら演出を出す。
   */
  addElementExp(amount) {
    const id = this.meta.activeElement;
    const el = elementById(id);
    const lv = this.elementLevelOf(id);
    if (lv >= el.expTable.length) return;

    const before = this.elementExpOf(id);
    const need = el.expTable[lv];
    this.meta.elementExp[id] = before + amount;

    // 撃破条件を満たした瞬間だけ知らせる（実際の昇格はFragmentを払う）
    if (before < need && this.meta.elementExp[id] >= need) {
      this.sfx.elementLevelUp();
      this.flashScreen(0.18, el.color);
      this.showToast(
        el.name + ' コア Lv' + (lv + 1) + ' の撃破条件を達成  ' +
        this.elementLevelCost(el, lv) + '◆◆ で昇格可能',
        3400
      );
      this.requestSave();
      if (this.elements.isOpen) this.elements.build();
    }
  }

  /* ---------- 属性専用研究 ---------- */

  elementResearchLevel(id) { return this.meta.elementResearch[id] || 0; }

  buyElementResearch(el, r) {
    if (!this.isElementUnlocked(el.id)) return false;
    const lv = this.elementResearchLevel(r.id);
    if (lv >= r.maxLevel) return false;

    const cost = Math.floor(r.baseCost * Math.pow(r.growth, lv));
    if (this.meta.coin < cost) return false;

    this.meta.coin -= cost;
    this.meta.elementResearch[r.id] = lv + 1;
    this.player.recalc();
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /** ブラックホール（重力Lv5） */
  spawnBlackhole(x, y, radius, damage) {
    this.blackholes.push({ x, y, radius, damage, life: 1.2, maxLife: 1.2 });
    this.sfx.explosion();
    this.shakeScreen(6);
  }

  updateBlackholes(dt) {
    for (let i = this.blackholes.length - 1; i >= 0; i--) {
      const b = this.blackholes[i];
      b.life -= dt;

      // 範囲内の敵を中心へ引き込みつつダメージ
      const rSq = b.radius * b.radius;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (!e) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rSq) continue;
        const d = Math.sqrt(d2) || 1;
        if (!e.knockbackImmune) {
          e.x += (dx / d) * 220 * dt;
          e.y += (dy / d) * 220 * dt;
        }
        this.damageEnemy(e, b.damage * dt, 0, false);
      }

      if (b.life <= 0) swapRemove(this.blackholes, i);
    }
  }

  /** 属性効果の強さ（研究やモジュールで伸ばせる） */
  elementPower() {
    return this.player ? this.player.stats.elementPower : 1;
  }

  /** 次の周回から使う属性を選ぶ */
  selectElement(id) {
    if (!this.isElementUnlocked(id)) return false;
    this.meta.pendingElement = id;
    if (!this.running) {
      this.meta.activeElement = id;
      if (this.player) this.player.recalc();
    }
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    return true;
  }

  /** 電撃の描画用エフェクト */
  spawnLightning(x1, y1, x2, y2) {
    this.lightnings.push({ x1, y1, x2, y2, life: 0.18 });
  }

  updateLightnings(dt) {
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      this.lightnings[i].life -= dt;
      if (this.lightnings[i].life <= 0) swapRemove(this.lightnings, i);
    }
  }

  /** 燃焼などの継続効果。0.2秒間隔で適用して負荷を抑える */
  updateStatusEffects(dt) {
    this.burnTimer = (this.burnTimer || 0) + dt;
    if (this.burnTimer < 0.2) return;
    const step = this.burnTimer;
    this.burnTimer = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e) continue;
      // サイフォンは毎秒わずかに自己回復する
      if (e.special && e.special.type === 'leech' && e.hp > 0 && e.hp < e.maxHp) {
        e.hp = Math.min(e.hp + e.maxHp * e.special.regen * step, e.maxHp);
      }
      if (e.burnTimer <= 0) continue;
      e.burnTimer -= step;
      this.damageEnemy(e, e.burnDps * step, 0, false);
      if (Math.random() < 0.3) {
        this.spawnParticles(e.x, e.y, 1, 40, 0.3, 2, '#ff7a3d');
      }
    }
  }

  /* ---------- オーバークロック ---------- */

  onOverclockStart(isSuper) {
    this.runOverclocks = (this.runOverclocks || 0) + 1;
    this.vibrate(isSuper ? [30, 40, 30] : 20);
    this.flashScreen(isSuper ? 0.45 : 0.28, isSuper ? '#ff2d95' : '#ffc233');
    this.shakeScreen(isSuper ? 14 : 8);
    if (isSuper) {
      this.sfx.superOverclock();
      this.showToast('★ SUPER OVERCLOCK ★', 2400);
    } else {
      this.sfx.overclock();
      this.showToast('OVERCLOCK', 1600);
    }
    this.hud.heatWrap.classList.toggle('super', !!isSuper);
    this.hud.heatWrap.classList.toggle('overclock', !isSuper);
    this.hud.heatWrap.classList.remove('overheat');
  }

  onOverheatStart() {
    this.flashScreen(0.2, '#ff3b5c');
    this.sfx.overheat();
    this.hud.heatWrap.classList.remove('overclock', 'super');
    this.hud.heatWrap.classList.add('overheat');
  }

  onOverheatEnd() {
    this.hud.heatWrap.classList.remove('overheat');
  }

  /* ---------- 開発者モード ---------- */

  onDevTap() {
    const now = Date.now();
    if (now - this._devTapTime > 3000) this._devTaps = 0;
    this._devTapTime = now;
    this._devTaps++;

    if (this._devTaps < 7) {
      // 4回目以降は残り回数を知らせる
      if (this._devTaps >= 4) {
        this.showToast('あと ' + (7 - this._devTaps) + ' 回', 1200);
      }
      return;
    }

    this._devTaps = 0;
    this.meta.devMode = !this.meta.devMode;
    this.requestSave();
    this.flushSave();
    this.settings.refresh();
    this.showToast(
      this.meta.devMode
        ? '開発者メニューを有効にしました（設定画面）'
        : '開発者メニューを無効にしました',
      2600
    );
    this.sfx.unlockTier();
  }

  /** 開発者メニューの操作 */
  devGrant(kind) {
    if (kind === 'coin') this.meta.coin += 100000;
    else if (kind === 'gem') this.meta.gem += 10000;
    else if (kind === 'shard') this.meta.shards += 50000;
    else if (kind === 'frag') this.meta.fragments += 50;
    else if (kind === 'cash') this.addCash(1e9);
    else if (kind === 'unlockAll') {
      // 全Tierを解放した状態にする（到達Wave記録を引き上げる）
      const last = UPGRADE_TIERS[UPGRADE_TIERS.length - 1].requiredWave;
      if (this.meta.bestWave < last) this.meta.bestWave = last;
      this.checkTierUnlocks();
      this.shop.buildList();
      this.research.build();
      this.lab.build();
    } else if (kind === 'reset') {
      this.meta.coin = 0;
      this.meta.gem = 0;
      this.meta.shards = 0;
      this.meta.fragments = 0;
    }
    this.requestSave();
    this.flushSave();
    this.hudDirty = true;
    this.sfx.buy();
  }

  /* ---------- 通貨 ---------- */

  addCash(amount) {
    this.cash += amount;
    if (this.running && !this.paused) this.runCashEarned += amount;
    if (this.cash > this.meta.maxCash) {
      this.meta.maxCash = this.cash;
      this.saveDirty = true;
    }
  }

  spendCash(amount) {
    this.cash -= amount;
    const el = this.hud.cashItem;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  addCoin(amount) {
    if (this.running) this.runCoinEarned += amount * this.player.stats.coinBonus;
    this.coinFrac += amount * this.player.stats.coinBonus;
    if (this.coinFrac >= 1) {
      const whole = Math.floor(this.coinFrac);
      this.meta.coin += whole;
      this.coinFrac -= whole;
      this.saveDirty = true;
    }
  }

  addGem(amount) {
    if (this.running) this.runGemEarned += amount;
    this.meta.gem += amount;
    this.saveDirty = true;
  }

  /* ---------- 画面サイズ・背景 ---------- */

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.renderScaleCap());
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

  /** 周回開始時の共通処理（研究の初期資金・開始Waveを適用） */
  beginRun() {
    // 選択中の属性を周回開始時に確定させる
    if (this.meta.pendingElement && this.meta.pendingElement !== this.meta.activeElement) {
      this.meta.activeElement = this.meta.pendingElement;
      this.player.recalc();
    }
    // 熱をリセット
    this.player.heat = 0;
    this.player.heatState = 'normal';
    this.hud.heatWrap.classList.remove('overclock', 'overheat', 'super');

    const s = this.player.stats;
    this.cash = s.startingCash + this.meta.pendingCash;
    this.meta.pendingCash = 0;
    this.runKills = 0;
    this.runBossKills = 0;
    this.coinFrac = 0;
    // リザルト表示用の周回内カウンタ（表示専用・バランスには影響しない）
    this.runCoinEarned = 0;
    this.runGemEarned = 0;
    this.runCashEarned = 0;
    this.runCrits = 0;
    this.runOverclocks = 0;

    // 開始Waveは「戦域転送」で解放した上限内で、設定から選んだ値を使う
    const startWave = Math.max(1, Math.min(this.meta.selectedStartWave, s.startWave));
    this.waveManager.wave = startWave - 1;

    this.meta.totalRuns++;
    this.requestSave();

    this.running = true;
    this.lastTime = performance.now();
    this.waveManager.startNextWave();
    this.sfx.startBgm();
    this.checkAchievements();
    requestAnimationFrame(this._loop);
  }

  /* ---------- 画面ステート ---------- */

  /** 戦闘中の属性クイック情報の表示切替（属性名・Lv・簡単な効果） */
  toggleElementQuickInfo() {
    const qi = document.getElementById('element-quickinfo');
    if (!qi) return;
    if (!qi.classList.contains('hidden')) {
      qi.classList.add('hidden');
      return;
    }
    const el = this.activeElement();
    const icon = document.getElementById('eqi-icon');
    icon.textContent = el.icon;
    icon.style.color = el.color;
    document.getElementById('eqi-name').textContent = el.name;
    document.getElementById('eqi-name').style.color = el.color;
    document.getElementById('eqi-lv').textContent = 'Lv ' + this.elementLevelOf(el.id);
    document.getElementById('eqi-desc').textContent = el.desc || el.tagline || '';
    qi.classList.remove('hidden');
    this.sfx.buy();
    clearTimeout(this._eqiTimer);
    this._eqiTimer = setTimeout(() => qi.classList.add('hidden'), 4500);
  }

  /** body のステートクラスを切り替える（CSSで表示を出し分ける） */
  setScreenState(state) {
    const b = document.body;
    b.classList.remove('state-title', 'state-home', 'state-battle');
    b.classList.add('state-' + state);
    this.screenState = state;
  }

  /* ---------- 表示設定（Phase 5-A②） ---------- */

  /** エフェクト品質・解像度など、表示系設定をまとめて適用する */
  applyDisplaySettings() {
    const q = this.meta.fxQuality;
    this.fxMul = q === 'low' ? 0.4 : (q === 'med' ? 0.7 : 1);
    // 画質（解像度）は resize で dpr に反映される
    if (this.canvas) this.resize();
    // FPS表示のトグル
    if (this.hud && this.hud.fps) {
      this.hud.fps.classList.toggle('force-hidden',
        !(this.meta.showFps || this.meta.devMode));
    }
  }

  /** 画質設定に応じた最大DPR（解像度上限） */
  renderScaleCap() {
    const s = this.meta.renderScale;
    if (s === 'low') return 1;
    if (s === 'med') return 1.5;
    return CONFIG.DPR_MAX;
  }

  /** カメラ表示倍率（0.7〜1.2、範囲外は1に丸める） */
  zoomFactor() {
    const z = this.meta.zoom;
    return (typeof z === 'number' && z >= 0.5 && z <= 2) ? z : 1;
  }

  /** 対応端末での触覚フィードバック（設定でOFFなら何もしない） */
  vibrate(pattern) {
    if (!this.meta.vibrationOn) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch (e) { /* 非対応端末は無視 */ }
    }
  }

  /** 戦闘中に一時停止（設定を開いている間など）。ゲームバランスには影響しない */
  setPaused(on) {
    this.paused = !!on;
  }

  /** 戦闘を中断してホームへ戻る（リタイア）。獲得済み通貨は保持される */
  retreatToHome() {
    if (this.waveManager && this.waveManager.wave > this.meta.bestWave) {
      this.meta.bestWave = this.waveManager.wave;
    }
    this.requestSave();
    this.flushSave();
    this.setPaused(false);
    this.prepareFreshBattle();
    this.showHome();
  }

  /** タイトル「起動する」→ 音声解放・オフライン報酬回収の上でホームへ */
  bootToHome() {
    this.hud.overlayStart.classList.add('hidden');

    // オフライン報酬があれば受け取り画面を表示する
    const r = this.pendingOffline;
    if (r) {
      this.pendingOffline = null;
      this.grantOfflineReward(r);
      const h = Math.floor(r.minutes / 60);
      const m = Math.floor(r.minutes % 60);
      this.hud.offlineTime.textContent =
        (h > 0 ? h + '時間 ' : '') + m + '分';
      this.hud.offlineCash.textContent = '$' + formatNumber(r.cash);
      this.hud.offlineCoin.textContent = formatNumber(r.coin) + ' ◎';
      this.hud.offlineGem.textContent = formatNumber(r.gem) + ' ◆';
      this.hud.offlineGemRow.style.display = r.gem > 0 ? '' : 'none';
      this.hud.offlineOverlay.classList.remove('hidden');
      this.sfx.package_();
    }

    // 不在中に完了した研究があれば知らせる
    const labDone = this.offlineLabDone;
    if (labDone && labDone.length > 0) {
      this.offlineLabDone = null;
      const names = labDone.map((r) => r.name + ' Lv' + r.level).join(' / ');
      setTimeout(() => this.showToast('研究完了: ' + names, 3600), 900);
    }

    this.showHome();
  }

  /** ホーム画面（拠点）を表示する */
  showHome() {
    this.running = false;
    this.closePanels(null);
    this.setScreenState('home');

    this.hud.overlayStart.classList.add('hidden');
    this.hud.overlayGameOver.classList.add('hidden');
    this.hud.overlayHome.classList.remove('hidden');

    // ホームではBGMを止めて静かにする（出撃時に再開）
    this.sfx.setBgmIntensity(false);
    this.sfx.stopBgm();

    this.updateHomeHud();
    this.startHomeRefresh();   // パネルでの通貨変動をホームに反映
    this.renderFrame();        // 背後のコア/グリッドを1フレーム描画
  }

  /** ホーム表示中だけ上部バーを定期更新する（軽量ポーリング） */
  startHomeRefresh() {
    this.stopHomeRefresh();
    this._homeTimer = setInterval(() => {
      if (this.screenState === 'home') this.updateHomeHud();
      else this.stopHomeRefresh();
    }, 300);
  }

  stopHomeRefresh() {
    if (this._homeTimer) {
      clearInterval(this._homeTimer);
      this._homeTimer = null;
    }
  }

  /** ホーム画面上部の通貨・属性・Lv・バージョン・プレイ時間を更新 */
  updateHomeHud() {
    const h = this.hud;
    const m = this.meta;
    if (!h.overlayHome) return;

    h.homeCoin.textContent = formatNumber(m.coin);
    h.homeGem.textContent = formatNumber(m.gem);
    h.homeFrag.textContent = formatNumber(m.fragments);

    // 装備中（次周回で確定）の属性を表示
    const elId = (m.pendingElement && m.pendingElement !== 'none')
      ? m.pendingElement : m.activeElement;
    const el = elementById(elId) || elementById('none');
    h.homeElement.textContent = el.icon + ' ' + el.name;
    h.homeElement.style.color = el.color;

    h.homeLevel.textContent = this.homePlayerLevel();
    h.homeVersion.textContent = GAME_VERSION;
    h.homePlaytime.textContent = this.formatPlaytime(m.playTime);
  }

  /** 表示専用のプレイヤーLv（進行度から算出、ゲーム性には影響しない） */
  homePlayerLevel() {
    const m = this.meta;
    const kills = m.totalKills || 0;
    const best = m.bestWave || 0;
    return 1 + Math.floor(Math.sqrt(kills / 40)) + Math.floor(best / 5);
  }

  formatPlaytime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    if (sec < 60) return sec + '秒';
    if (sec < 3600) return Math.floor(sec / 60) + '分';
    const h = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    return h + '時間 ' + min + '分';
  }

  /** 次の戦闘に向けて盤面をまっさらにする（周回の共通初期化） */
  prepareFreshBattle() {
    this.releaseAll(this.enemies, this.enemyPool);
    this.releaseAll(this.projectiles, this.projectilePool);
    this.releaseAll(this.enemyProjectiles, this.enemyProjectilePool);
    this.releaseAll(this.particles, this.particlePool);
    this.releaseAll(this.damageNumbers, this.damageNumberPool);
    this.releaseAll(this.mines, this.minePool);
    this.releaseAll(this.shockwaves, this.shockwavePool);
    this.releaseAll(this.packages, this.packagePool);
    this.lightnings.length = 0;
    this.blackholes.length = 0;

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
    this.sfx.setBgmIntensity(false);
  }

  /** ホーム「START」→ 現在の構成を読み込み、ズーム演出付きで出撃 */
  enterBattle() {
    this.stopHomeRefresh();
    this.closePanels(null);
    this.hud.overlayHome.classList.add('hidden');
    this.hud.overlayGameOver.classList.add('hidden');
    this.setScreenState('battle');

    // 装備・属性・研究・モジュールを最新状態で反映してから出撃
    this.player.recalc();

    // 軽いズーム演出
    document.body.classList.add('battle-enter');
    setTimeout(() => document.body.classList.remove('battle-enter'), 600);

    // 3・2・1・START のカウントダウン後に周回開始
    this.startCountdown(() => this.beginRun());
  }

  /** 戦闘開始カウントダウン（3→2→1→START）。演出のみでバランス不変 */
  startCountdown(done) {
    const overlay = document.getElementById('overlay-countdown');
    const num = document.getElementById('countdown-num');
    if (!overlay || !num) { done(); return; }

    // カウントダウン中は静止した戦場を背後に描画しておく
    this.renderFrame();
    overlay.classList.remove('hidden');
    const seq = ['3', '2', '1', 'START'];
    let i = 0;
    const tick = () => {
      if (i >= seq.length) {
        overlay.classList.add('hidden');
        done();
        return;
      }
      const last = (i === seq.length - 1);
      num.textContent = seq[i];
      num.classList.toggle('cd-go', last);
      // アニメを再生し直す
      num.classList.remove('cd-anim');
      void num.offsetWidth;
      num.classList.add('cd-anim');
      this.sfx.unlock();
      if (last) { this.sfx.waveClear(); this.vibrate(30); }
      else { this.sfx.buy(); }
      i++;
      setTimeout(tick, last ? 550 : 620);
    };
    tick();
  }

  /** 戦闘終了（リザルト）→ ホームへ戻る */
  returnToHome() {
    this.prepareFreshBattle();
    this.hud.overlayGameOver.classList.add('hidden');
    this.showHome();
  }

  releaseAll(arr, pool) {
    for (let i = 0; i < arr.length; i++) pool.release(arr[i]);
    arr.length = 0;
  }

  gameOver() {
    this.running = false;
    this.setPaused(false);
    this.closePanels(null);
    this.sfx.gameOver();
    this.vibrate([60, 50, 120]);
    this.flashScreen(0.4, '#ff3b5c');
    this.shakeScreen(CONFIG.SHAKE_MAX);

    const earned = Math.floor(
      this.waveManager.wave * 1.5 + this.runKills * 0.1
    );
    this.addCoin(earned);
    // 終了ボーナスもリザルトの「獲得Coin」に含める（running=false 後のため手動加算）
    this.runCoinEarned += earned * this.player.stats.coinBonus;

    // 周回の記録を永続データへ反映
    if (this.waveManager.wave > this.meta.bestWave) {
      this.meta.bestWave = this.waveManager.wave;
    }
    this.requestSave();
    this.checkAchievements();
    this.flushSave();

    const h = this.hud;
    h.goWave.textContent = this.waveManager.wave;
    h.goKills.textContent = formatNumber(this.runKills);
    h.goCoin.textContent = formatNumber(Math.floor(this.runCoinEarned));
    if (h.goCash) h.goCash.textContent = '$' + formatNumber(Math.floor(this.runCashEarned));
    if (h.goGem) h.goGem.textContent = formatNumber(this.runGemEarned);
    if (h.goCrit) h.goCrit.textContent = formatNumber(this.runCrits);
    if (h.goOverclock) h.goOverclock.textContent = formatNumber(this.runOverclocks);
    h.overlayGameOver.classList.remove('hidden');
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

    this.runBossKills++;
    this.meta.bossKills++;

    // Core Fragment: ボス討伐（高Waveほど多く得られる）
    const frag = 1 + Math.floor(this.waveManager.wave / 250);
    this.addFragments(frag);

    // 「結晶探知」の抽選でGemを獲得
    if (Math.random() < this.player.stats.gemChance) {
      const amount = Math.max(1, Math.floor(this.player.stats.gemFindMul));
      this.addGem(amount);
      this.showToast('Gem を獲得しました  +' + amount + '◆');
    }
    this.requestSave();
    this.checkAchievements();

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

    // Wave Skip: 次のWaveを戦わずに報酬だけ受け取る
    if (s.waveSkipChance > 0 && Math.random() < s.waveSkipChance) {
      this.waveManager.wave++;
      const skipped = this.waveManager.wave;
      const reward = Math.floor(
        (20 + skipped * 8) * WAVE_RULES.cashMul(skipped) * s.cashBonus
      );
      this.addCash(reward);
      this.showToast('WAVE ' + skipped + ' をスキップ  +$' + formatNumber(reward));
      this.flashScreen(0.14, '#3dff9e');
      this.sfx.package_();
    }

    if (wave > this.meta.bestWave) this.meta.bestWave = wave;
    if (this.player.maxWallHp > 0 && this.player.wallHp > 0 &&
        wave > this.meta.bestWaveWithWall) {
      this.meta.bestWaveWithWall = wave;
    }
    this.requestSave();
    this.checkAchievements();
    this.checkTierUnlocks();
    this.checkGemMilestones();

    this.sfx.waveClear();
  }

  /* ---------- メインループ ---------- */

  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > CONFIG.MAX_DT) dt = CONFIG.MAX_DT;

    // 一時停止中はゲーム内時間を進めず、描画とループのみ継続する
    if (this.paused) {
      this.renderFrame();
      requestAnimationFrame(this._loop);
      return;
    }

    // 演出タイマーは実時間で減衰させる
    const realDt = dt;
    if (this.shake > 0) this.shake = Math.max(this.shake - realDt * 42, 0);
    if (this.flash > 0) this.flash -= realDt;

    // ヒットストップ中はゲーム内時間を大幅に遅くする
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      dt *= CONFIG.HITSTOP_SCALE;
    }

    // ゲームスピード倍率。1フレームでまとめて進めると当たり判定が
    // 抜けるため、MAX_DT 以下のサブステップに分割して更新する。
    let remaining = dt * this.gameSpeed;
    let guard = 0;
    while (remaining > 0 && guard < 16) {
      const step = Math.min(remaining, CONFIG.MAX_SUBSTEP);
      this.update(step);
      remaining -= step;
      guard++;
    }
    this.renderFrame();
    this.updateHud(realDt);
    this.updateFps(realDt);

    // 5秒間隔のオートセーブ（変更があった場合のみ書き込む）
    this.meta.playTime += realDt;
    this.autoSaveTimer += realDt;
    if (this.autoSaveTimer >= 5) {
      this.autoSaveTimer = 0;
      this.flushSave();
    }

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
    this.updateLightnings(dt);
    this.updateStatusEffects(dt);

    // 属性コアの常時効果
    const el = this.activeElement();
    if (el.passive) el.passive(this, dt, this.elementPower(), this.elParams);
    this.updateBlackholes(dt);

    this.shop.update(dt);
    this.lab.update(dt);

    // 研究の完了判定（1秒間隔で十分なので負荷は無視できる）
    this.labCheckTimer = (this.labCheckTimer || 0) + dt;
    if (this.labCheckTimer >= 1) {
      this.labCheckTimer = 0;
      if (this.meta.labJobs.length > 0) this.processLabJobs(false);
    }

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
      if (!e) continue;
      const dist = e.update(dt, this);

      // 壁またはコアへの接触
      if (dist <= barrier + e.size) {
        // 壁の反射ダメージや属性の連鎖爆発でこの敵自身が倒される場合があるため、
        // ダメージ処理のあとに改めて配列の位置を取り直す。
        // カミカゼ: コア接触で自爆し、通常より大きなダメージと範囲爆発
        if (e.special && e.special.type === 'bomber') {
          this.player.takeDamage(e.atk, e);
          this.explode(e.x, e.y, e.special.blastRadius, 0, '#ff2d5c');
          this.spawnParticles(e.x, e.y, 22, 260, 0.5, 4, '#ff2d5c');
          this.shakeScreen(7);
          this.flashScreen(0.14, '#ff2d5c');
          this.sfx.explosion();
          const bidx = this.enemies.indexOf(e);
          if (bidx !== -1) {
            this.waveManager.killed++;
            this.enemyPool.release(swapRemove(this.enemies, bidx));
          }
          if (i > this.enemies.length) i = this.enemies.length;
          continue;
        }

        this.player.takeDamage(e.atk, e);
        this.spawnParticles(e.x, e.y, 8, 140, 0.3, 3, e.type.color);
        this.sfx.explosion();

        if (e.isBoss) {
          // ボスは接触しても消滅せず、ノックバックして戦闘継続
          const ang = Math.atan2(e.y - this.cy, e.x - this.cx);
          e.x = this.cx + Math.cos(ang) * (barrier + e.size + 40);
          e.y = this.cy + Math.sin(ang) * (barrier + e.size + 40);
        } else {
          const idx = this.enemies.indexOf(e);
          if (idx !== -1) {
            this.waveManager.killed++;
            this.enemyPool.release(swapRemove(this.enemies, idx));
          }
        }

        // 連鎖で配列が大きく縮んだ場合にインデックスを追従させる
        if (i > this.enemies.length) i = this.enemies.length;
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

      // 太いボス弾（レーザー等）は弾半径ぶんだけ接触判定を広げる
      const hitR = barrier + (p.radius || 5);
      if (!dead && dx * dx + dy * dy <= hitR * hitR) {
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

    // 重力の重圧：プレイヤーに近い敵ほど与ダメージが増える
    const elForDmg = this.activeElement();
    if (elForDmg.damageMul) {
      dmg *= elForDmg.damageMul(this, enemy, this.elementPower(), this.elParams);
    }

    if (s.armorBreakChance > 0 && Math.random() < s.armorBreakChance) {
      enemy.dmgTakenMul = s.armorBreakMultiplier;
      enemy.armorBreakTimer = CONFIG.ARMOR_BREAK_DURATION;
    }

    // シールダー: 正面から当たった弾はダメージが軽減される
    const reduction = enemy.shieldReductionFor(projectile.px, projectile.py);
    if (reduction > 0) {
      dmg *= 1 - reduction;
      // シールドで弾かれた表現
      this.spawnParticles(projectile.x, projectile.y, 3, 90, 0.2, 2, '#4fa8ff');
    }

    // サイフォン: ダメージを受けると一部を自己回復する
    if (enemy.special && enemy.special.type === 'leech' && enemy.hp > 0) {
      const heal = dmg * enemy.special.healOnHitPct;
      enemy.hp = Math.min(enemy.hp + heal, enemy.maxHp);
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

    // ---- 属性コアの命中効果 ----
    const el = this.activeElement();
    if (el.onHit && enemy.hp > 0) {
      el.onHit(this, enemy, dmg, this.elementPower(), this.elParams);
    }

    // ---- Critical Chain: クリティカル時の追撃 ----
    if (projectile.critTier > 0 && s.critChainChance > 0 &&
        Math.random() < s.critChainChance) {
      const extra = this.findBounceTarget(projectile, null);
      if (extra) this.player.fireAt(extra);
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
    const range = projectile.bounceRange > 0
      ? projectile.bounceRange
      : this.player.stats.range;
    const rSq = range * range;
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
    if (!enemy || enemy.hp <= 0) return;
    let dmg = amount * enemy.dmgTakenMul;
    // 凍結中の敵は追加ダメージを受ける（氷Lv5）
    if (enemy.stunTimer > 0 && enemy.frozenBonus > 1) dmg *= enemy.frozenBonus;
    if (enemy.isBoss) dmg *= this.player.stats.bossDamageMul;
    // ボスの再生シールド発動中は被ダメージを大幅に軽減
    if (enemy.bossShieldTimer > 0) dmg *= 0.15;
    enemy.hp -= dmg;
    enemy.hitFlash = 0.08;
    this.dpsAccum += dmg;

    if (showNumber && this.meta.showDamage !== false) {
      const d = this.damageNumberPool.acquire();
      d.init(enemy.x, enemy.y - enemy.size, dmg, critTier || 0);
      this.damageNumbers.push(d);
    }

    // Lifesteal: 与ダメージの一部をHPへ還元
    const steal = this.player.stats.lifesteal;
    if (steal > 0 && this.player.hp < this.player.stats.maxHp) {
      this.player.heal(dmg * steal);
    }

    // Execution: 瀕死の敵を即撃破（ボスは対象外）
    const th = this.player.stats.executeThreshold;
    if (enemy.hp > 0 && th > 0 && !enemy.isBoss && enemy.hp / enemy.maxHp <= th) {
      enemy.hp = 0;
      this.spawnParticles(enemy.x, enemy.y, 8, 200, 0.3, 3, '#ffffff');
    }

    // 重力圧縮: 一定割合以下の敵を重力で圧壊させる（ボスにも有効）
    if (enemy.hp > 0) {
      const gLine = enemy.isBoss
        ? this.player.stats.gravBossExecute
        : this.player.stats.gravExecute;
      if (gLine > 0 && enemy.hp / enemy.maxHp <= gLine) {
        enemy.hp = 0;
        this.spawnGravityCrush(enemy.x, enemy.y, enemy.size);
      }
    }

    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;

    const s = this.player.stats;
    // 経済コアはボス報酬に追加倍率がかかる
    const bossMul = enemy.isBoss && this.elParams && this.elParams.bossReward
      ? this.elParams.bossReward : 1;
    this.addCash(Math.ceil(enemy.cash * s.cashBonus * bossMul));
    if (enemy.coin > 0) this.addCoin(enemy.coin);
    if (s.coinPerKill > 0) this.addCoin(s.coinPerKill);
    this.runKills++;
    this.meta.totalKills++;
    this.addElementExp(1);
    this.waveManager.killed++;

    const tid = enemy.type.id;
    this.killsByType[tid] = (this.killsByType[tid] || 0) + 1;

    // 属性の撃破時効果。爆発が別の敵を巻き込んで無限連鎖しないよう
    // 連鎖の深さを制限する（3段まで）。
    const el = this.activeElement();
    if (el.onKill) {
      this._killDepth = (this._killDepth || 0) + 1;
      if (this._killDepth <= 3) {
        el.onKill(this, enemy, this.elementPower(), this.elParams);
      }
      this._killDepth--;
    }

    if (enemy.isBoss) {
      this.onBossDefeat(enemy);
    } else {
      this.spawnParticles(enemy.x, enemy.y, 10, 170, 0.35, 3, enemy.type.color);
      // パッケージドロップ
      if (s.packageChance > 0 && Math.random() < s.packageChance) {
        this.spawnPackage(enemy.x, enemy.y, enemy.cash * 2);
      }
      // ディバイダー: 撃破時に子機へ分裂する
      if (enemy.special && enemy.special.type === 'splitter') {
        this.splitEnemy(enemy);
      }
      // カミカゼ: 撃破時（＝コア接触前でも）小さく爆発
      if (enemy.special && enemy.special.type === 'bomber') {
        this.spawnParticles(enemy.x, enemy.y, 14, 220, 0.4, 3.4, '#ff2d5c');
      }
    }

    this.enemyPool.release(swapRemove(this.enemies, idx));
  }

  /** ディバイダーを子機へ分裂させる */
  splitEnemy(parent) {
    const sp = parent.special;
    const childType = ENEMY_TYPES.find((t) => t.id === sp.childId);
    if (!childType) return;

    for (let i = 0; i < sp.count; i++) {
      const ang = (i / sp.count) * TAU + Math.random();
      const child = this.enemyPool.acquire();
      child.init(childType, this.waveManager.wave, parent.x, parent.y, 1);
      // 中央HPを引き継がず子機の基礎HPで出す。少し外側へ散らす
      child.x = parent.x + Math.cos(ang) * 18;
      child.y = parent.y + Math.sin(ang) * 18;
      this.enemies.push(child);
    }
    this.spawnParticles(parent.x, parent.y, 10, 160, 0.35, 3, parent.type.color);
  }

  /* ---------- ボス専用AI ---------- */

  /** ボスの行動パターンを設定する（出現時に呼ぶ） */
  setupBoss(boss) {
    const patterns = bossPatternsFor(this.meta.bossKills);
    boss.bossPatterns = patterns;
    boss.bossPatternTimers = patterns.map((p, i) => p.interval * (0.6 + i * 0.3));
    boss._telegraphing = null;
  }

  /** ボスのレーザー掃射: コア方向へ太い貫通弾を放つ */
  fireBossLaser(boss) {
    const ang = Math.atan2(this.cy - boss.y, this.cx - boss.x);
    const speed = 340;
    // 3連の弾で太いレーザーを表現
    for (let i = -1; i <= 1; i++) {
      const a = ang + i * 0.05;
      const p = this.enemyProjectilePool.acquire();
      p.initVel(boss.x, boss.y, Math.cos(a) * speed, Math.sin(a) * speed, boss.atk * 0.8, '#ff2d95');
      p.isLaser = true;
      p.radius = 8;
      this.enemyProjectiles.push(p);
    }
    this.sfx.overheat();
    this.flashScreen(0.12, '#ff2d95');
  }

  /** ボスの増援召喚 */
  bossSummon(boss, count) {
    const pool = ENEMY_TYPES.filter(
      (t) => !t.boss && t.weight > 0 && t.minWave <= this.waveManager.wave
    );
    if (pool.length === 0) return;
    for (let i = 0; i < count; i++) {
      const type = pool[Math.floor(Math.random() * pool.length)];
      const ang = Math.random() * TAU;
      const e = this.enemyPool.acquire();
      e.init(type, this.waveManager.wave, boss.x + Math.cos(ang) * 40,
        boss.y + Math.sin(ang) * 40, 1);
      this.enemies.push(e);
      // 召喚された敵は enemies.length のクリア判定に含まれるため、
      // 別途カウンタを操作する必要はない（倒すまでWaveは終わらない）
    }
    this.spawnParticles(boss.x, boss.y, 16, 180, 0.5, 4, '#4fa8ff');
    this.sfx.package_();
  }

  /** ボスの衝撃波: コアを取り囲む弾をばら撒く */
  bossShockwave(boss) {
    const count = 16;
    const speed = 220;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const p = this.enemyProjectilePool.acquire();
      // コアの外周から内向きに撃つ
      const r = 260;
      const sx = this.cx + Math.cos(a) * r;
      const sy = this.cy + Math.sin(a) * r;
      p.initVel(sx, sy, -Math.cos(a) * speed, -Math.sin(a) * speed, boss.atk * 0.5, '#ffc233');
      this.enemyProjectiles.push(p);
    }
    this.shakeScreen(8);
    this.sfx.explosion();
  }

  discoverEnemy(id) {
    if (!this.discovered.has(id)) {
      this.discovered.add(id);
      this.requestSave();
      this.checkAchievements();
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
    const rings = s.orbRings;
    const total = n * rings;

    for (let k = 0; k < total; k++) {
      const ring = Math.floor(k / n);
      const o = k % n;
      // リングごとに半径・回転方向を変えて視認性を上げる
      const dir = ring % 2 === 0 ? 1 : -1;
      const radius = CONFIG.ORB_RADIUS + ring * 34;
      const a = baseAngle * dir + (o / n) * TAU + ring * 0.6;
      const ox = this.cx + Math.cos(a) * radius;
      const oy = this.cy + Math.sin(a) * radius;

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e) continue;
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
    const s = this.player.stats;
    // Mine Cluster の数だけ、コア周辺のランダム位置へ設置
    for (let i = 0; i < s.mineCount; i++) {
      if (this.mines.length >= CONFIG.MINE_MAX) return;
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
      if (!e) continue;
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

  /** 重力圧縮：敵が内側へ潰れる演出（吸い込むパーティクル＋小さな衝撃） */
  spawnGravityCrush(x, y, size) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = (size || 12) + 14;
      // 外周から中心へ吸い込まれるように動く粒子
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const part = this.particlePool.acquire();
      part.init(px, py, -Math.cos(a) * 180, -Math.sin(a) * 180, 0.28, 2.6, '#c77dff');
      this.particles.push(part);
    }
    this.spawnShockwave(x, y, (size || 12) + 6, '#a561ff');
    this.spawnParticles(x, y, 6, 60, 0.3, 3, '#e0c0ff');
    this.sfx.hit();
  }

  /** 重力崩壊：圧力波（炎の爆発とは異なる、内向きに収束してから弾ける演出） */
  spawnPressureWave(x, y, radius) {
    // 収束するリング（負の速度で内向き）＋外へ抜ける圧力波リング
    this.spawnShockwave(x, y, radius, '#a561ff');
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = radius * 0.9;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const part = this.particlePool.acquire();
      // いったん中心へ collapse する圧力の流れ
      part.init(px, py, -Math.cos(a) * 260, -Math.sin(a) * 260, 0.32, 3, '#b57dff');
      this.particles.push(part);
    }
    this.spawnParticles(x, y, 10, 120, 0.3, 2.4, '#e0c0ff');
    this.shakeScreen(4);
    this.sfx.explosion();
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
      if (!e) continue;
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
    const mul = this.fxMul != null ? this.fxMul : 1;
    count = Math.max(1, Math.round(count * mul));
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
    // カメラ表示倍率（コア中心を固定してスケール）。Canvasサイズは不変。
    const z = this.zoomFactor();
    const s = this.dpr * z;
    const tx = (this.cx * (1 - z) + sx) * this.dpr;
    const ty = (this.cy * (1 - z) + sy) * this.dpr;
    ctx.setTransform(s, 0, 0, s, tx, ty);

    this.drawRange(ctx);
    this.drawGarlicField(ctx);
    this.drawMines(ctx);
    this.drawEnemies(ctx);
    this.drawEnemyProjectiles(ctx);
    this.drawProjectiles(ctx);
    this.drawLightnings(ctx);
    this.drawShockwaves(ctx);
    this.drawPackages(ctx);
    this.drawParticles(ctx);
    this.drawWall(ctx);
    this.drawOrbs(ctx);
    this.drawCore(ctx);
    this.drawDamageNumbers(ctx);

    // SUPER OVERCLOCK 中は画面全体を染める
    if (this.player.heatState === 'super') {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const pulse = 0.10 + Math.sin(this.player.pulse * 4) * 0.05;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff2d95';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

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
    const rings = s.orbRings;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 14;
    for (let k = 0; k < n * rings; k++) {
      const ring = Math.floor(k / n);
      const o = k % n;
      const dir = ring % 2 === 0 ? 1 : -1;
      const radius = CONFIG.ORB_RADIUS + ring * 34;
      const a = base * dir + (o / n) * TAU + ring * 0.6;
      const ox = this.cx + Math.cos(a) * radius;
      const oy = this.cy + Math.sin(a) * radius;
      ctx.beginPath();
      ctx.arc(ox, oy, CONFIG.ORB_SIZE, 0, TAU);
      ctx.fillStyle = ring === 0 ? '#7df0ff' : '#c79dff';
      ctx.fill();
      ctx.strokeStyle = ring === 0 ? '#00e5ff' : '#a561ff';
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

  drawLightnings(ctx) {
    if (this.lightnings.length === 0) return;
    ctx.save();
    ctx.strokeStyle = '#ffe14d';
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.lightnings.length; i++) {
      const l = this.lightnings[i];
      ctx.globalAlpha = Math.max(l.life / 0.18, 0);
      // ジグザグに折れた線で電撃らしく見せる
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      const segs = 4;
      for (let k = 1; k < segs; k++) {
        const t = k / segs;
        const mx = l.x1 + (l.x2 - l.x1) * t + (Math.random() - 0.5) * 16;
        const my = l.y1 + (l.y2 - l.y1) * t + (Math.random() - 0.5) * 16;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
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
    // 重力属性の重圧場：中心に近い敵ほど濃い重力リングを敷く
    const gravEl = this.activeElement();
    const gravActive = gravEl.id === 'gravity';
    const gravRange = gravActive
      ? this.player.stats.range * GRAVITY.pressureRangeFactor
      : 0;
    const gravCore = gravActive ? (this.player.stats.gravCore || 1) : 1;

    if (gravActive) {
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e) continue;
        const dx = e.x - this.cx;
        const dy = e.y - this.cy;
        const nd = Math.min(Math.hypot(dx, dy) / (gravRange || 1), 1);
        const intensity = (1 - nd);           // 中心へ近いほど1へ
        if (intensity <= 0.02) continue;
        const rY = e.y + Math.sin(e.wobble) * 1.5;
        // 歪みリング（近いほど濃く・太く）
        ctx.strokeStyle = 'rgba(165, 97, 255, ' + (0.12 + intensity * 0.55 * gravCore) + ')';
        ctx.lineWidth = 1 + intensity * 2.5;
        ctx.beginPath();
        ctx.arc(e.x, rY, e.size + 5 + intensity * 8, 0, TAU);
        ctx.stroke();
        // 至近ではさらに内側の重い輪を重ねる
        if (intensity > 0.5) {
          ctx.strokeStyle = 'rgba(224, 192, 255, ' + ((intensity - 0.5) * 0.7) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(e.x, rY, e.size + 2, 0, TAU);
          ctx.stroke();
        }
      }
    }

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

      // 遠距離敵の発射予告（着弾前に気づけるようにする）
      if (e.type.behavior === 'ranged' && e.fireTimer > 0 && e.fireTimer < 0.55) {
        const t = 1 - e.fireTimer / 0.55;
        ctx.strokeStyle = 'rgba(165, 97, 255, ' + (0.15 + t * 0.45) + ')';
        ctx.lineWidth = 1 + t * 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(e.x, y);
        ctx.lineTo(this.cx, this.cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 状態異常の表示
      if (e.burnTimer > 0) {
        ctx.strokeStyle = 'rgba(255, 122, 61, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 4, 0, TAU);
        ctx.stroke();
      }
      if (e.chillTimer > 0 && e.chill > 0) {
        ctx.strokeStyle = 'rgba(127, 216, 255, ' + (0.3 + e.chill * 0.6) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 6, -Math.PI / 2, -Math.PI / 2 + TAU * e.chill);
        ctx.stroke();
      }
      if (e.stunTimer > 0) {
        ctx.fillStyle = 'rgba(255, 225, 77, 0.9)';
        ctx.beginPath();
        ctx.arc(e.x, y - size - 8, 2.5, 0, TAU);
        ctx.fill();
      }

      // シールダー: 進行方向側のバリアを弧で描く
      if (e.special && e.special.type === 'shield' && e.stunTimer <= 0) {
        ctx.strokeStyle = 'rgba(79, 168, 255, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 5, e.moveAngle - e.special.angle,
          e.moveAngle + e.special.angle);
        ctx.stroke();
      }

      // ベヒモス: 重量感のある外周リング
      if (e.special && e.special.type === 'brute') {
        ctx.strokeStyle = 'rgba(255, 92, 61, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 4, 0, TAU);
        ctx.stroke();
      }

      // メディック: 回復範囲を淡いリングで示す
      if (e.special && e.special.type === 'healer') {
        ctx.strokeStyle = 'rgba(61, 255, 158, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, y, e.special.radius, 0, TAU);
        ctx.stroke();
      }

      // サイフォン: 回復オーラ
      if (e.special && e.special.type === 'leech') {
        ctx.strokeStyle = 'rgba(165, 97, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(e.x, y, size + 4, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ボスのシールド展開中は全身をリングで覆う
      if (e.isBoss && e.bossShieldTimer > 0) {
        ctx.strokeStyle = 'rgba(61, 255, 158, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 14 + Math.sin(e.wobble * 2) * 3, 0, TAU);
        ctx.stroke();
      }

      // ボスの攻撃予兆: 発動前に色付きリングで警告する
      if (e.isBoss && e.bossTelegraph > 0) {
        const tt = e.bossTelegraph;
        ctx.strokeStyle = e.bossTelegraphColor;
        ctx.globalAlpha = 0.4 + Math.sin(tt * 18) * 0.3;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, y, size + 20, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

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
      if (!e.isBoss && e.hp < e.maxHp && this.meta.showEnemyHp !== false) {
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
      ctx.shadowBlur = p.isLaser ? 16 : 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius || 5, 0, TAU);
      ctx.fill();
      // レーザーは尾を引く
      if (p.isLaser) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = (p.radius || 8);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0;
  }

  drawProjectiles(ctx) {
    const skin = this.activeSkin();
    ctx.lineCap = 'round';
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const tier = p.critTier;
      ctx.strokeStyle = tier === 2 ? '#ff2d95' : tier === 1 ? '#ffc233' : skin.shot;
      ctx.lineWidth = tier === 2 ? 5 : tier === 1 ? 4 : 2.5;
      ctx.shadowColor = tier === 2 ? '#ff2d95' : tier === 1 ? '#ffc233' : skin.core;
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

    const skin = this.activeSkin();

    ctx.shadowColor = hurt > 0 ? '#ff3b5c' : rapid ? '#ffc233' : skin.core;
    ctx.shadowBlur = 22 * glow + hurt * 20 + (rapid ? 12 : 0);

    tracePolygon(ctx, 0, 0, r, 6, 0);
    ctx.fillStyle = hurt > 0
      ? `rgba(255, 59, 92, ${0.25 + hurt * 0.4})`
      : rapid ? 'rgba(255, 194, 51, 0.16)' : 'rgba(255, 255, 255, 0.10)';
    ctx.fill();
    ctx.strokeStyle = hurt > 0 ? '#ff5c78' : rapid ? '#ffc233' : skin.core;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.rotate(-p.rotation * 2.2);
    tracePolygon(ctx, 0, 0, r * 0.5, 6, 0);
    ctx.strokeStyle = skin.accent;
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
    h.coin.textContent = formatNumber(this.meta.coin);
    h.gem.textContent = formatNumber(this.meta.gem);
    h.frag.textContent = formatNumber(this.meta.fragments);

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

    // 熱ゲージ
    const heatRatio = p.heat / CONFIG.HEAT_MAX;
    h.heatFill.style.width = (heatRatio * 100).toFixed(1) + '%';
    h.heatLabel.textContent = p.heatState === 'super'
      ? '★SUPER ' + p.heatStateTimer.toFixed(1) + 's'
      : p.heatState === 'overclock'
        ? 'OVERCLOCK ' + p.heatStateTimer.toFixed(1) + 's'
        : p.heatState === 'overheat'
          ? 'OVERHEAT ' + p.heatStateTimer.toFixed(1) + 's'
          : 'HEAT ' + Math.round(heatRatio * 100) + '%';

    // 属性バッジ
    const el = this.activeElement();
    h.elementBadge.textContent = el.icon + ' ' + el.name;
    h.elementBadge.style.color = el.color;

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

  showToast(message, duration) {
    const t = this.hud.toast;
    t.textContent = message;
    t.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => t.classList.add('hidden'), duration || 1800
    );
  }
}

/* =========================================================
 * 11. 起動
 * ======================================================= */

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
