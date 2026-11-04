export const RISK_THRESHOLD = 6
export const FIXED_HIGH_RISK = 18

export const computeRisk = (impact: number, reversibility: number, detection: number): number =>
  impact * (reversibility + detection)

export const isHot = (risk: number): boolean => risk >= RISK_THRESHOLD
