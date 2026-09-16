export const Icon = ({ name, size = 20, stroke = 1.9 }) => {
  const paths = {
    search: 'M20 20l-4.5-4.5m2.5-5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    trash: 'M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14',
    coffee: 'M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8zm12 3h2a2 2 0 0 1 0 4h-2M7 4h7',
    grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6m-6 4h6',
    pause: 'M8 5v14M16 5v14',
    table: 'M4 4h16v4H4zm4 4v12m8-12v12M2 20h20',
    card: 'M3 6h18v12H3zM3 10h18M7 15h3',
    check: 'M5 12l4 4L19 6',
    x: 'M6 6l12 12M18 6L6 18',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    edit: 'M4 17.5V21h3.5L18 10.5 14.5 7 4 17.5zM13.5 8l3.5 3.5',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z',
    user: 'M20 21a8 8 0 0 0-16 0m12-12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    printer: 'M6 9V3h12v6M4 9h16a1 1 0 0 1 1 1v7H3V10a1 1 0 0 1 1-1zM6 17v4h12v-4M9 13h.01M13 13h.01',
    return: 'M9 14l-5-5 5-5M4 9h11a5 5 0 0 1 0 10H11',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-9V3m0 18v-3m9-6h-3M6 12H3m15.36-6.36-2.12 2.12M6.76 17.24l-2.12 2.12M18.36 17.24l-2.12-2.12M6.76 6.76 4.64 4.64',
    wifi: 'M5 13a10 10 0 0 1 14 0M1.5 9.5a15 15 0 0 1 21 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01',
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.coffee} />
    </svg>
  )
}
