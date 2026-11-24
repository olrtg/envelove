type CategoryAmounts = { assigned: number; activity: number; available: number }

// A Category Group's amounts sum its visible Categories.
export function sumVisibleAmounts(
  categories: Array<CategoryAmounts & { hidden: boolean }>,
): CategoryAmounts {
  return categories.reduce(
    (sum, category) =>
      category.hidden
        ? sum
        : {
            assigned: sum.assigned + category.assigned,
            activity: sum.activity + category.activity,
            available: sum.available + category.available,
          },
    { assigned: 0, activity: 0, available: 0 },
  )
}
