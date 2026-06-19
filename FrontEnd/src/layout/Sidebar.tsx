import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Leaf, 
  LayoutDashboard, 
  Eye, 
  Zap, 
  Database, 
  Settings,
  ChevronDown,
  ChevronRight,
  History,
  MapPin,
  Cpu,
  FileSpreadsheet,
  RefreshCw,
  Layers,
  Sprout,
  ClipboardList
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  title: string;
  href?: string;
  icon: React.ElementType;
  children?: {
    title: string;
    href: string;
    icon?: React.ElementType;
  }[];
};

const navigation: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Monitoring',
    icon: Eye,
    children: [
      { title: 'Field Map 2D', href: '/monitoring/map', icon: MapPin },
      { title: 'Petak Lahan', href: '/monitoring/sub-blocks', icon: Layers },
    ],
  },
  {
    title: 'Recommendations',
    icon: Zap,
    children: [
      { title: 'DSS Output', href: '/recommendations/dss', icon: Zap },
      { title: 'Riwayat Log', href: '/recommendations/history', icon: History },
    ],
  },
  {
    title: 'Master Data',
    icon: Database,
    children: [
      { title: 'Lahan Sawah', href: '/master/fields', icon: Sprout },
      { title: 'Profil Aturan', href: '/master/rules', icon: FileSpreadsheet },
      { title: 'Siklus Tanam', href: '/master/cycles', icon: RefreshCw },
      { title: 'Hardware Device', href: '/master/devices', icon: Cpu },
    ],
  },
  {
    title: 'Penugasan',
    href: '/tasks',
    icon: ClipboardList,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const [openStates, setOpenStates] = useState<Record<string, boolean>>({
    'Monitoring': false,
    'Recommendations': false,
    'Master Data': false,
  });

  const toggleOpen = (title: string) => {
    setOpenStates(prev => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card shadow-sm transition-all duration-300">
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px]">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="h-5 w-5" />
          </div>
          <span className="font-bold text-primary">Smart AWD</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="grid items-start px-2 text-sm font-medium">
          {navigation.map((item) => {
            const hasChildren = !!item.children;
            const isOpen = openStates[item.title];

            return (
              <div key={item.title} className="mb-1">
                {hasChildren ? (
                  <button
                    onClick={() => toggleOpen(item.title)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all"
                  >
                    <div className="flex items-center">
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.title}</span>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                ) : (
                  <NavLink
                    to={item.href || '#'}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-lg px-3 py-2 transition-all",
                        isActive 
                          ? "bg-primary/10 text-primary" 
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )
                    }
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    {item.title}
                  </NavLink>
                )}

                {/* Sub-menu items */}
                {hasChildren && isOpen && item.children && (
                  <div className="mt-1 flex flex-col space-y-1 pl-6">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.href}
                        to={child.href}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center rounded-lg px-3 py-2 text-sm transition-all",
                            isActive 
                              ? "bg-primary/10 text-primary font-medium" 
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          )
                        }
                      >
                        {child.icon ? <child.icon className="mr-2 h-3.5 w-3.5" /> : <div className="mr-2 h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                        {child.title}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
