"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { useDemoMode } from '@/context/DemoModeContext';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // With no Supabase configuration the honest state is "signed out and ready":
  // nothing is pending because nothing can be fetched. `getSupabase()` still
  // fails loudly for any code that actually needs the database.
  const [loading, setLoading] = useState(configured);
  const { isDemoMode } = useDemoMode();

  useEffect(() => {
    if (!configured) return;

    const supabase = getSupabase();
    let mounted = true;

    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  const logout = async () => {
    if (!configured) return;
    await getSupabase().auth.signOut();
  };

  // Demo mode has no session, but the placeholder still has to satisfy `User`. Declaring it
  // `any`-adjacent let consumers read fields a real session would never carry.
  const mockUser: User = {
    id: 'demo-user-id',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'demo@agririse.africa',
    app_metadata: {},
    user_metadata: { full_name: 'Demo Investor' },
    created_at: '1970-01-01T00:00:00.000Z',
  };

  const activeUser = isDemoMode ? mockUser : user;

  return (
    <AuthContext.Provider value={{ user: activeUser, session, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
