import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Api, loadConnection, saveConnection, type Connection } from './api';

type Ctx = {
  api: Api;
  connection: Connection;
  ready: boolean;
  setConnection: (c: Connection) => Promise<void>;
  /** Bumped whenever the feed should be reloaded (new refresh, prefs change). */
  feedVersion: number;
  bumpFeed: () => void;
};

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [connection, setConn] = useState<Connection>({ serverUrl: '', token: '' });
  const [ready, setReady] = useState(false);
  const [feedVersion, setFeedVersion] = useState(0);

  useEffect(() => {
    loadConnection().then((c) => {
      setConn(c);
      setReady(true);
    });
  }, []);

  const setConnection = useCallback(async (c: Connection) => {
    setConn(c);
    await saveConnection(c);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      api: new Api(connection),
      connection,
      ready,
      setConnection,
      feedVersion,
      bumpFeed: () => setFeedVersion((v) => v + 1),
    }),
    [connection, ready, setConnection, feedVersion],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
