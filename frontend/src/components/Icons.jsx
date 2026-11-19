function Icon({ name, size = 18, fill = 'none' }) {
  const common = { fill, stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const shapes = {
    ArrowUpRight: <><path d="M7 17 17 7M8 7h9v9" /></>,
    ArrowRight: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    ArrowLeft: <><path d="M20 12H5M11 6l-6 6 6 6" /></>,
    ArrowDown: <><path d="M12 4v15m-6-6 6 6 6-6" /></>,
    MapPin: <><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" /><circle cx="12" cy="9" r="2.2" /></>,
    MapPinPlus: <><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" /><path d="M12 6.5v5M9.5 9h5" /></>,
    ImagePlus: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="9" r="1.5" /><path d="m5 17 5-5 3 3 2-2 4 4M17 3v5M14.5 5.5h5" /></>,
    Search: <><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 4.5 4.5" /></>,
    CalendarDays: <><rect x="3.5" y="5" width="17" height="16" rx="1.5" /><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></>,
    Star: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></>,
    Tag: <><path d="M3.5 12V4.5H11l9.5 9.5-6.5 6.5L4.5 11Z" /><circle cx="8" cy="8" r="1" /></>,
    Check: <><path d="m4 12.5 5 5L20 6" /></>,
    ClipboardCheck: <><rect x="5" y="5" width="14" height="16" rx="1.5" /><path d="M9 5V3h6v2M8.5 13l2.2 2.2 4.8-4.8" /></>,
    ClipboardList: <><path d="M8 4.5h8M8 8.5h8M8 12.5h8M8 16.5h5" /><path d="M5 3.5h14v17H5z" /></>,
    Clock3: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    CircleCheck: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    CircleDashed: <><circle cx="12" cy="12" r="9" strokeDasharray="3 3" /></>,
    Bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    Circle: <><circle cx="12" cy="12" r="8" /></>,
    Building2: <><path d="M3 20.5h18M5 20V8l7-4 7 4v12M9 10v2M15 10v2M9 15v2M15 15v2M11 20v-4h2v4" /></>,
    RotateCcw: <><path d="M3.5 11a8.5 8.5 0 1 1 2.2 6M3.5 4v7h7" /></>,
    ShieldCheck: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
    UserRound: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>{shapes[name]}</svg>
}

export const ArrowUpRight = (props) => <Icon name="ArrowUpRight" {...props} />
export const ArrowRight = (props) => <Icon name="ArrowRight" {...props} />
export const ArrowLeft = (props) => <Icon name="ArrowLeft" {...props} />
export const ArrowDown = (props) => <Icon name="ArrowDown" {...props} />
export const MapPin = (props) => <Icon name="MapPin" {...props} />
export const MapPinPlus = (props) => <Icon name="MapPinPlus" {...props} />
export const ImagePlus = (props) => <Icon name="ImagePlus" {...props} />
export const Search = (props) => <Icon name="Search" {...props} />
export const CalendarDays = (props) => <Icon name="CalendarDays" {...props} />
export const Star = (props) => <Icon name="Star" {...props} />
export const Tag = (props) => <Icon name="Tag" {...props} />
export const Check = (props) => <Icon name="Check" {...props} />
export const ClipboardCheck = (props) => <Icon name="ClipboardCheck" {...props} />
export const ClipboardList = (props) => <Icon name="ClipboardList" {...props} />
export const Clock3 = (props) => <Icon name="Clock3" {...props} />
export const CircleCheck = (props) => <Icon name="CircleCheck" {...props} />
export const CircleDashed = (props) => <Icon name="CircleDashed" {...props} />
export const Bell = (props) => <Icon name="Bell" {...props} />
export const Circle = (props) => <Icon name="Circle" {...props} />
export const Building2 = (props) => <Icon name="Building2" {...props} />
export const RotateCcw = (props) => <Icon name="RotateCcw" {...props} />
export const ShieldCheck = (props) => <Icon name="ShieldCheck" {...props} />
export const UserRound = (props) => <Icon name="UserRound" {...props} />
