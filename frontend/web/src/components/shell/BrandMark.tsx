/** The Cartouche logo of the dashboard: a notched card with a « C ». */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg className={`${className} flex-none`} viewBox="0 0 28 28" aria-hidden="true">
      <path
        className="fill-app-brand"
        d="M7 2h14a5 5 0 0 0 5 5v14a5 5 0 0 0-5 5H7a5 5 0 0 0-5-5V7a5 5 0 0 0 5-5z"
      />
      <path
        className="stroke-app-on-primary"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        d="M17.5 10.5a4.5 4.5 0 1 0 0 7"
      />
    </svg>
  );
}
