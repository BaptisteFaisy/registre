/**
 * Demo identities for the judges (EF-ADM-03).
 *
 * Passwords are public by design: they unlock a read-only demo dataset that
 * contains no real customer or partner material.
 */

import type { Principal, Role } from '../api/types.ts';

export interface DemoAccount {
  login: string;
  password: string;
  principal: Principal;
}

function principal(
  id: string,
  name: string,
  email: string,
  role: Role,
  clearance: Principal['clearance'],
  ownedControls: string[] = []
): Principal {
  return { id, name, email, role, clearance, ownedControls };
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    login: 'quality@northwind.example',
    password: 'demo-quality',
    principal: principal(
      'pr-quality',
      'Amina Diallo',
      'amina.diallo@northwind.example',
      'QUALITY_LEAD',
      'RESTRICTED'
    )
  },
  {
    login: 'owner@northwind.example',
    password: 'demo-owner',
    principal: principal(
      'pr-owner',
      'Kwame Mensah',
      'kwame.mensah@northwind.example',
      'CONTROL_OWNER',
      'INTERNAL',
      ['BCP-01', 'BCP-02', 'BCP-03', 'BCP-04', 'BCP-05']
    )
  },
  {
    login: 'executive@northwind.example',
    password: 'demo-executive',
    principal: principal(
      'pr-exec',
      'Claire Fontaine',
      'claire.fontaine@northwind.example',
      'EXECUTIVE',
      'INTERNAL'
    )
  },
  {
    login: 'auditor@northwind.example',
    password: 'demo-auditor',
    principal: principal(
      'pr-auditor',
      'Noah Bertrand',
      'noah.bertrand@northwind.example',
      'INTERNAL_AUDITOR',
      'INTERNAL'
    )
  },
  {
    login: 'admin@northwind.example',
    password: 'demo-admin',
    principal: principal(
      'pr-admin',
      'Inès Kaya',
      'ines.kaya@northwind.example',
      'ADMIN',
      'RESTRICTED'
    )
  }
];

/** Finds the demo account matching a login and password, if any. */
export function findAccount(login: string, password: string): DemoAccount | null {
  const normalised = login.trim().toLowerCase();
  return (
    DEMO_ACCOUNTS.find(
      (account) => account.login === normalised && account.password === password
    ) ?? null
  );
}

/** Finds a demo account by principal id (session restore). */
export function accountById(id: string): DemoAccount | null {
  return DEMO_ACCOUNTS.find((account) => account.principal.id === id) ?? null;
}
