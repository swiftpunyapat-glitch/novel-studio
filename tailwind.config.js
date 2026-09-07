/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sarabun: ['var(--font-sarabun)', 'Sarabun', 'sans-serif'],
      },
      colors: {
        paper: {
          50: '#faf9f6',
          100: '#f5f3ee',
          200: '#e8e5dc',
          800: '#25262b',
          900: '#1a1b1e',
        }
      }
    },
  },
  plugins: [],
}
