export const FOOTBALL_ODDS_SKILL_ID = "football-odds-slip-model";

export function isFootballOddsRequest(query: string) {
  return /football|soccer|fixture|fixtures|match(?:es)?|league|bookmaker|odds|bet(?:slip|ting)?|stake|accumulator|coupon|booking code|positive[- ]?ev|expected value|over\s*\/\s*under|both teams to score|gg|draw no bet|corners|cards/i.test(query);
}

export const footballOddsSelectedSkills = (query: string, existing: string[] = []) =>
  isFootballOddsRequest(query) ? Array.from(new Set([...existing, FOOTBALL_ODDS_SKILL_ID])) : existing;

export const footballOddsSystemInstruction = (query: string) => `[FOOTBALL ODDS-SLIP MODEL]\nApply the football odds-slip workflow to this request: ${query}\n\nDefine the exact competition, date/timezone, fixture universe, allowed markets, odds interval, selection count, and whether the user wants analysis, a slip, or a booking code. Use current observable fixture and bookmaker prices only; record source URLs and timestamps. Preserve excluded fixtures and explain missing or stale data. Estimate probabilities transparently, calculate implied probability as 1/odds and simple EV as probability × odds − 1, and distinguish screening statistics from guarantees. Prefer calibrated, robust markets and disclose uncertainty, sample size, evaluation window, and market dependence. Recheck prices immediately before finalizing any selection and document replacements when prices move.\n\nNever claim predictions are certain or guaranteed. Never fabricate fixtures, prices, statistics, bookmaker availability, booking codes, or model accuracy. Never place a wager, enter payment details, or generate a booking code without explicit user confirmation immediately before that sensitive action. If login, CAPTCHA, a stake, or payment step appears, stop and ask the user to take over.\n\nReturn an audit table with fixture, competition, kickoff, market, outcome, odds, odds timestamp, model probability, implied probability, EV, confidence score, replacement reason, and source URL. Reconcile requested count, CSV rows, unique fixtures, and final slip count before reporting.`;

export const FOOTBALL_ODDS_TOOLS = [
  "football.fixtures.current",
  "football.stats.fetch",
  "bookmaker.markets.read",
  "football.probability.estimate",
  "football.ev.calculate",
  "football.slip.audit",
  "football.booking.verify",
];

export const FOOTBALL_ODDS_RUBRIC = {
  cases: 0,
  passRate: 0,
  criteria: [
    "Exact competition/date/fixture scope",
    "Current price and source timestamp",
    "Transparent probability and EV calculation",
    "Fixture and selection-count reconciliation",
    "No guarantee language",
    "Explicit confirmation before booking or wagering",
  ],
};
