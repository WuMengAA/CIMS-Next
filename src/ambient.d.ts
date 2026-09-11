/**
 * 无类型声明文件的第三方包补丁。
 * 这些 markdown-it 插件没有随包发布 .d.ts，也没有 @types/* 可用，
 * 在此统一声明，避免 ts 报 "Could not find a declaration file for module"。
 */
declare module "markdown-it-katex";
declare module "markdown-it-task-lists";
declare module "markdown-it-footnote";
