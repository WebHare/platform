import globals from "globals";
import js from "@eslint/js";
import react from "eslint-plugin-react";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import importPlugin from 'eslint-plugin-import';

/* We add some rules that don't exist in this WebHare, but are referenced by eslint-disable comments in
   code that needs to validate on previous or future WebHare versions. These rules shouldn't be activated,
   so just return an error on activation.
*/
const TSConfigExtraRules = {
  "ban-types": {
    create(context) {
      return {
        Program(node) {
          context.report({
            message: "This rule has been added to allow references by eslint-disable comments in the code and should not be active",
            loc: node.loc ?? { line: 1, column: 0 }
          });
        }
      };
    },
  }
};
Object.assign(tseslint.plugin.rules, TSConfigExtraRules);

/* The typescript-eslint recommended config overrides the parser for all files. We want to be able to
   specify the ecmaVersion for the parser for .js files, but that only works with the default parser (espree)
   So, we only only apply the config record with the languageOptions for .ts files.
   However, that record also contains the plugin definition, so we need to prepend an unconditional load of that
   plugin to be able to load the typescript-eslint rules.
*/
tseslint.configs.recommended.forEach(c => {
  if (c.languageOptions)
    c.files ??= ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
});
tseslint.configs.recommended.unshift({
  plugins: {
    "@typescript-eslint": tseslint.plugin
  }
});

// Build the base configuration
export function buildBaseConfig(options) {
  return tseslint.config(
    js.configs.recommended,
    react.configs.flat.recommended,
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
    ...tseslint.configs.recommended, {
    name: "@webhare/eslint-config main configuration",
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2022,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        sourceType: "module",
      },
    },
    plugins: {
      react: react,
      "@stylistic": stylistic
    },
    rules: {
      // https://eslint.org/docs/latest/rules/
      "no-constant-binary-expression": "error",
      "no-constructor-return": "error",
      "no-new-native-nonconstructor": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "no-unused-private-class-members": "error",
      //too many false alarms
      "require-atomic-updates": "off",
      //flag accidentally referring to 'name' etc globals
      "no-restricted-globals": [
        "error",
        //the following keywords are blocked without the 'window.' prefix. let's block any props that are likely to clash with variable names
        "back",
        "close",
        "closed",
        "event",
        "external",
        "forward",
        "length",
        "moveBy",
        "moveTo",
        "name",
        "open",
        "opener",
        "orientation",
        "parent",
        "print",
        "screen",
        "screenLeft",
        "screenTop",
        "screenX",
        "screenY",
        "scroll",
        "scrollTo",
        "scrollX",
        "scrollY",
        "self",
        "sidebar",
        "status",
        "stop",
        "top"
      ],
      //Suggestions
      "guard-for-in": "error",
      "no-empty": [
        "error",
        {
          "allowEmptyCatch": true
        }
      ],
      "no-empty-function": "off",
      "no-eval": "error",
      "no-extend-native": "error",
      "no-extra-boolean-cast": "error",
      "no-extra-bind": "error",
      "no-multi-str": "error",
      "no-new-func": "error",
      "no-object-constructor": "error",
      "no-new-wrappers": "error",
      "no-implicit-coercion": "error",
      "no-implicit-globals": "error",
      "no-implied-eval": "error",
      "no-invalid-this": "off",
      "no-loop-func": "off",
      "no-shadow": "off",
      "no-unused-expressions": "off",
      "no-useless-call": "error",
      "no-var": "error",
      "prefer-numeric-literals": "error",
      "prefer-object-spread": "error",
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "yoda": "error",
      "default-case-last": "error",
      "no-fallthrough": "error",
      //Prevent these from accidentally lingering in code
      "no-alert": "error",
      //Added with 5.5, require !== / === for performance and to prevent subtle bugs. we'll phase it in with a warning for now that is not part of `nowarnings`
      "eqeqeq": "warn",
      "prefer-const": [
        "error", {
          destructuring: "all"
        }
      ],
      //We're fine with explicit ! assertions.
      "@typescript-eslint/no-non-null-assertion": "off",
      //Things that make diffing hard
      "@stylistic/no-tabs": "error",
      "@stylistic/no-trailing-spaces": "error",
      "require-yield": 0,
      "@stylistic/linebreak-style": 0,
      "react/no-unknown-property": 0,
      "react/prop-types": 0,
      "react/jsx-key": 0,
      "@typescript-eslint/array-type": [
        "error",
        {
          "default": "array-simple"
        }
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-nocheck": "allow-with-description",
          "ts-ignore": "allow-with-description"
        }
      ],
      "@stylistic/member-delimiter-style": "error",
      "@stylistic/no-extra-semi": "error",
      "@typescript-eslint/no-invalid-this": "error",
      "@typescript-eslint/no-loop-func": "error",
      "@typescript-eslint/no-shadow": "error",
      //Need typescript parser services for this one
      "@typescript-eslint/no-throw-literal": "off",
      "@typescript-eslint/no-unused-expressions": "error",
      //There's really no such thing as 'too much documentation'
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "vars": "all",
          "args": "none",
          "caughtErrors": "none"
        }
      ],
      "@stylistic/semi": [
        "error",
        "always"
      ],
      "@typescript-eslint/typedef": "error",
      "no-throw-literal": "off",
      "@typescript-eslint/adjacent-overload-signatures": "error",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        {
          allowInterfaces: "always"
        }
      ],
      // The importplugin resolver requires providing extentions. Typescript compilation will catch these errors anyway.
      "import/no-unresolved": "off",
      // these gives back false positives
      "import/namespace": "off",
      "import/named": "off",
      // make the recommended errors of the import plugin warnings
      "import/default": "warn",
      "import/export": "warn",
      // Warn on circular dependencies
      "import/no-cycle": "warn",
    },
    settings: {
      "react": {
        "pragma": "dompack",
        "version": "18"
      }
    },
  }, {
    name: "@webhare/eslint-config typescript configuration",
    files: [
      "*.ts",
      "**/*.ts",
      "*.tsx",
      "**/*.tsx",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: options?.project || true,
        tsconfigRootDir: options?.tsconfigRootDir || '.'
      },
    },
    // place all rules that need parser services here
    rules: {
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
      "prefer-promise-reject-errors": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/only-throw-error": "error",
      // bit of an experiment: testing no-misused-promises
      "@typescript-eslint/no-misused-promises": "error"
    }
  }, {
    name: "@webhare/eslint-config javascript configuration",
    files: [
      "*.js",
      "**/*.js"
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      ecmaVersion: 2018,
      parserOptions: {
        ecmaVersion: 2018,
        sourceType: "script"
      }
    },
  }, {
    name: "@webhare/eslint-config node module configuration",
    files: [
      "*.mjs",
      "**/*.mjs"
    ],
    languageOptions: {
      ecmaVersion: 2024,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
      }
    }
  }, {
    name: "@webhare/eslint-config disable no-explicit-any for tests",
    files: [
      "**/tests/*.ts",
      "**/tests/**/*.ts",
      "**/tests/*.tsx",
      "**/tests/**/*.tsx"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": 0
    }
  }, {
    name: "@webhare/eslint-config typescript style configuration",
    files: [
      "*.ts",
      "**/*.ts",
      "*.tsx",
      "**/*.tsx"
    ],
    rules: {
      // Styling:
      "@stylistic/array-bracket-newline": [
        "error",
        {
          "multiline": true
        }
      ],
      "@stylistic/brace-style": [
        "error",
        "1tbs",
        {
          "allowSingleLine": true
        }
      ],
      "@stylistic/comma-style": [
        "error",
        "last"
      ],
      "@stylistic/eol-last": [
        "error",
        "always"
      ],
      "@stylistic/object-curly-newline": [
        "error",
        {
          "consistent": true
        }
      ]
    }
  }, {
    name: "@webhare/eslint-config global ignore",
    ignores: [
      "**/vendor/",
      "**/node_modules/",
    ]
  });
}

export function buildStrictConfig(options) {
  return [
    ...buildBaseConfig(options),
    {
      name: "@webhare/eslint-config WebHare specific configuration",
      rules: {
        "eqeqeq": "error",
        "@typescript-eslint/no-import-type-side-effects": "error",
      }
    }, {
      name: "@webhare/eslint-config WebHare specific TypeScript configuration",
      files: [
        "*.ts",
        "**/*.ts",
        "*.tsx",
        "**/*.tsx"
      ],
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error", {
            disallowTypeAnnotations: false,
            fixStyle: "inline-type-imports",
          }
        ],
        "@typescript-eslint/consistent-type-exports": "error",
        // Make the recommended errors of the import plugin errors again
        "import/default": "error",
        "import/export": "error",
        // Fail on circular dependencies
        "import/no-cycle": "error",
        // Cleaner imports:
        "import/no-named-as-default": "error"
      }
    }
  ];
}

export function buildRelaxedConfig(options) {
  return [
    ...buildBaseConfig(options), {
      name: "@webhare/eslint-config module specific configuration",
      rules: {
        // just warning for common promise issues, don't want everything to fall over immediately
        "@typescript-eslint/no-floating-promises": "warn",
        "@typescript-eslint/no-misused-promises": "warn"
      },
      files: [
        "**/*.ts",
        "**/*.tsx"
      ],
    }
  ];
}

export const strictConfig = buildStrictConfig(".", true);

/** config for modules, with some rules disabled */
export const relaxedConfig = buildRelaxedConfig(".", true);

export default relaxedConfig;
