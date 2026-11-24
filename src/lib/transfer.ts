export const transferSides = ['outflow', 'inflow'] as const

export type TransferSide = (typeof transferSides)[number]
