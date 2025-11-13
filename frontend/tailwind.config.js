/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: { green: "#10b981", blue: "#3b82f6", navy: "#0f172a" },
      },
      boxShadow: { soft: "0 8px 30px rgba(2, 8, 23, 0.06)" },
    },
  },
  plugins: [],
};
