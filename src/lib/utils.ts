import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins class names and lets later Tailwind classes win (shadcn/ui's helper)
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
