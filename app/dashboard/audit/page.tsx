"use client";
import { ComingSoonModule } from '@/components/ComingSoonModule';
import { History } from 'lucide-react';

export default function AuditPage() {
  return (
    <ComingSoonModule 
      title="Audit History" 
      icon={History} 
      description="Cryptographically secured ledger of all intelligence exports, dataset uploads, and system authorizations for compliance reporting."
    />
  );
}
