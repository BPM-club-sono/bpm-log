/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
      colors: {
        bpm: {
          base: '#0c071a',
          surface: '#150e2d',
          accent: '#8b5cf6',
          neon: '#c084fc',
          green: '#10b981',
          red: '#ef4444',
          glow: 'rgba(139, 92, 246, 0.15)'
        }
      }
    },
  },
  plugins: [],
}
