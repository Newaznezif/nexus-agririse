"use client";
import { useEffect, useRef } from "react";
import { useInView, motion, useMotionValue, useTransform, animate } from "framer-motion";

export function Counter({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  // Extract digits and surrounding text
  const numberMatch = value.match(/(\d+)/);
  const target = numberMatch ? parseInt(numberMatch[0]) : 0;
  const prefix = value.split(/\d+/)[0] || '';
  const suffix = value.split(/\d+/)[1] || '';

  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));

  useEffect(() => {
    if (isInView) {
      const controls = animate(count, target, { 
        duration: 2, 
        ease: "easeOut" 
      });
      return controls.stop;
    }
  }, [isInView, target, count]);

  return (
    <span ref={ref}>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}
