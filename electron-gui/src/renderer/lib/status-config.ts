import type { ThopterStatus } from '@/services/types'

export const statusConfig: Record<ThopterStatus, { label: string; color: string; dot: string }> = {
  running: {
    label: 'Running',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  waiting: {
    label: 'Waiting',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  done: {
    label: 'Done',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  inactive: {
    label: 'Inactive',
    color: 'bg-red-500/15 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
  },
}

/** Dot color class for use in compact contexts (e.g. tab bar) */
export function statusDotColor(status: ThopterStatus | null): string {
  return statusConfig[status ?? 'inactive']?.dot ?? statusConfig.inactive.dot
}
