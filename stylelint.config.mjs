/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard-scss'],
  rules: {
    'media-feature-range-notation': null,
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['global'] },
    ],
    'selector-class-pattern': '^([_a-z][a-z0-9]*)(-[a-z0-9]+)*$|^mantine.*$',
    'scss/no-duplicate-mixins': null,
    'scss/at-mixin-pattern': null,
    'scss/at-rule-no-unknown': null,
  },
};
