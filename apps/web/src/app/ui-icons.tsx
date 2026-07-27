import type { ButtonHTMLAttributes, ComponentType } from 'react';
import {
  BadgeCheck, BadgeX, BarChart3, BookCheck, BookOpenCheck, Boxes, Building2, CalendarRange, Check,
  CheckCheck, ChevronRight, CircleCheck, CircleDollarSign, CircleHelp, CircleX, ClipboardList, Clock3,
  Download, Ellipsis, Eye, FilePenLine, FileSpreadsheet, FileText, HandCoins, History, Inbox, Info,
  LayoutDashboard, ListFilter, Lock, LockOpen, LogOut, Menu, MessageSquare, Minus, Moon, Package, PackageSearch, Pencil,
  Plus, Printer, ReceiptText, RefreshCw, Ruler, Save, ScrollText, Search, SearchX, Send, Settings,
  ShoppingBag, ShoppingCart, Store, Sun, Tags, Trash2, TriangleAlert, Truck, Undo2, Upload, Users,
  Warehouse, X,
} from 'lucide-react';

export const iconMap = {
  dashboard: LayoutDashboard, sales: ShoppingCart, purchases: ShoppingBag, inventory: Warehouse, pos: ReceiptText,
  payments: HandCoins, accounting: BookOpenCheck, banking: Building2, approvals: BadgeCheck, reports: BarChart3,
  audit: ScrollText, add: Plus, close: X, menu: Menu, themeDark: Moon, themeLight: Sun, next: ChevronRight,
  success: CircleCheck, pending: Clock3, draft: FilePenLine, item: Package, supplier: Truck, history: History, remove: Trash2, minus: Minus, help: CircleHelp,
  checklist: ClipboardList, money: CircleDollarSign, approve: Check, approveAll: CheckCheck, warehouse: Boxes,
  search: Search, customer: Users, category: Tags, unit: Ruler, period: CalendarRange, settings: Settings,
  logout: LogOut, edit: Pencil, save: Save, send: Send, post: BookCheck, undo: Undo2, refresh: RefreshCw,
  more: Ellipsis, view: Eye, upload: Upload, download: Download, csv: FileSpreadsheet, pdf: FileText,
  print: Printer, filter: ListFilter, error: CircleX, warning: TriangleAlert, info: Info, rejected: BadgeX,
  lock: Lock, unlocked: LockOpen, inbox: Inbox, comment: MessageSquare, searchEmpty: SearchX, packageSearch: PackageSearch, store: Store,
} as const;
export type IconName = keyof typeof iconMap;

export function AppIcon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Icon = iconMap[name] as ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;
  return <Icon size={size} strokeWidth={1.9} className={className} aria-hidden />;
}

export function IconButton({ icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><AppIcon name={icon}/></button>;
}

export function OdinBrandLogo({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
  return <img className={`odin-brand-logo ${className}`} src="/brand/odin-logo.png" alt={decorative ? '' : 'ODIN'} aria-hidden={decorative || undefined}/>;
}
