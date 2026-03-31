import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  { ignores: [".next/", "node_modules/", "src/generated/"] },
];

export default eslintConfig;
