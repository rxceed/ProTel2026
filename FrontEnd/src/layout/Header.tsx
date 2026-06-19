import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, User, LogOut } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';

export function Header() {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const navigate = useNavigate();
  
  // Extract user info from localStorage if available
  const userStr = localStorage.getItem('user');
  let user = null;
  try {
    user = (userStr && userStr !== 'undefined') ? JSON.parse(userStr) : null;
  } catch (e) {
    user = null;
  }
  const initals = user?.full_name 
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()
    : 'U';

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-10 flex h-14 lg:h-[60px] items-center gap-4 border-b bg-background px-4 lg:px-6 shadow-sm">
      <Button variant="ghost" size="icon" className="md:hidden">
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle navigation menu</span>
      </Button>
      <div className="w-full flex-1">
        {/* Placeholder for Breadcrumbs or Search */}
      </div>
      
      <div className="flex items-center gap-2">
        <ModeToggle />
        
        <div className="relative">
          <Button 
            variant="ghost" 
            className="relative h-9 w-9 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
          >
            <span className="text-sm font-medium">{initals}</span>
          </Button>

          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-popover text-popover-foreground shadow-lg ring-1 ring-black ring-opacity-5 animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95">
              <div className="px-4 py-3 border-b">
                <p className="text-sm">Logged in as</p>
                <p className="truncate text-sm font-medium text-foreground">
                  {user?.email || 'admin@smartawd.id'}
                </p>
              </div>
              <div className="py-1">
                <button
                  className="flex w-full items-center px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { navigate('/profile'); setShowProfileMenu(false); }}
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </button>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
