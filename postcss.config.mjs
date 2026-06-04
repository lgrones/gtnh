export default {
  plugins: {
    'postcss-preset-mantine': { autoRem: true },
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '35em',
        'mantine-breakpoint-sm': '45em',
        'mantine-breakpoint-md': '60em',
        'mantine-breakpoint-lg': '80em',
        'mantine-breakpoint-xl': '100em',
      },
    },
  },
};
