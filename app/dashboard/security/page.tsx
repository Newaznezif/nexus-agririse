"use client";
import { ComingSoonModule } from '@/components/ComingSoonModule';
import { ShieldAlert } from 'lucide-react';

export default function SecurityPage() {
  return (
    <ComingSoonModule 
      title="Security Alerts" 
      icon={ShieldAlert} 
      description="Monitoring system integrity and data protection protocols. Zero-trust security framework status and unauthorized access detection."
    />
  );
}
