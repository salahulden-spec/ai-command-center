import {
  Home,
  FolderKanban,
  ListChecks,
  Users,
  Inbox,
  Bell,
  MessageCircle,
  Settings,
  Network,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavLink[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/people", label: "People", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const SECONDARY_NAV: NavLink[] = [
  { href: "/mind", label: "Mind View", icon: Network },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
];

export const MOBILE_NAV: NavLink[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/people", label: "People", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
];

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
