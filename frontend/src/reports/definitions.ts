/** Reports are reserved for questions that require calculations across records. */
export const reports = [
  {
    key: 'locations',
    title: 'Recurring locations',
    description:
      'Compare incident frequency by building, floor or seat, across all or selected categories.',
  },
  {
    key: 'timings',
    title: 'Response times',
    description:
      'Compare time from incident creation to first assignment, acknowledgment and resolution.',
  },
  {
    key: 'workload',
    title: 'Engineer workload',
    description: 'Compare active assignments and availability across all engineers.',
  },
  {
    key: 'categories',
    title: 'Category frequency',
    description: 'See which categories account for the most incidents.',
  },
] as const
export type ReportDefinition = (typeof reports)[number]
export type ReportKey = ReportDefinition['key']
