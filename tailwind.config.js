/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/views/**/*.ejs', './src/utils/viewHelpers.js', './src/models/**/*.js', './src/config/constants.js', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff', 100: '#d9e8ff', 200: '#bcd7ff', 500: '#2a7af3', 600: '#1668e3', 700: '#1155c0', 800: '#13479b',
        },
        senegal: { green: '#00853f', yellow: '#fdef42', red: '#e31b23' },
        page: '#f0f2f5',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(0,0,0,0.12)' },
    },
  },
  plugins: [],
};
