import React, { createContext, useContext } from 'react';
import type { SubtaskerService } from '../../core/SubtaskerService';

const ServiceContext = createContext<SubtaskerService | null>(null);

export function ServiceProvider({
  service,
  children
}: {
  service: SubtaskerService;
  children: React.ReactNode;
}) {
  return <ServiceContext.Provider value={service}>{children}</ServiceContext.Provider>;
}

export function useService(): SubtaskerService {
  const service = useContext(ServiceContext);
  if (!service) {
    throw new Error('useService must be used inside ServiceProvider');
  }
  return service;
}
