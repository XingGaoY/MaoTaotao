import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F1117',
        panel: '#171A22',
        panel2: '#202431',
        accent: '#EA580C',
        ink: '#F8FAFC',
        muted: '#98A2B3'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(234, 88, 12, 0.25), 0 16px 40px rgba(0, 0, 0, 0.25)'
      }
    }
  },
  plugins: []
} satisfies Config;
