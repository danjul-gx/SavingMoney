'use client'

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function CardSkeleton() {
  return (
    <div className="card flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3">
      <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  )
}
