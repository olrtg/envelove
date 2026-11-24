import type { AccountType } from './account.schemas'

export const accountGroups = ['cash', 'credit', 'loans', 'tracking'] as const

export type AccountGroup = (typeof accountGroups)[number]

export const accountGroupLabels: Record<AccountGroup, string> = {
  cash: 'Cash',
  credit: 'Credit',
  loans: 'Loans',
  tracking: 'Tracking',
}

export const accountTypeDetails: Record<
  AccountType,
  { group: AccountGroup; label: string }
> = {
  checking: { group: 'cash', label: 'Checking' },
  savings: { group: 'cash', label: 'Savings' },
  cash: { group: 'cash', label: 'Cash' },
  credit_card: { group: 'credit', label: 'Credit Card' },
  line_of_credit: { group: 'credit', label: 'Line of Credit' },
  mortgage: { group: 'loans', label: 'Mortgage' },
  auto_loan: { group: 'loans', label: 'Auto Loan' },
  student_loan: { group: 'loans', label: 'Student Loan' },
  personal_loan: { group: 'loans', label: 'Personal Loan' },
  medical_debt: { group: 'loans', label: 'Medical Debt' },
  other_debt: { group: 'loans', label: 'Other Debt' },
  asset: { group: 'tracking', label: 'Asset (e.g. Investment)' },
  liability: { group: 'tracking', label: 'Liability' },
}
