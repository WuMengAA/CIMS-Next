import { z } from "zod";

/**
 * 登录表单 schema（前后端共用同一份）。
 *
 * 必须共用：服务端用 `zod4(schema)`，客户端用 `zod4Client(schema)`，两者要拿到
 * **同一个** schema 对象。客户端适配器不接受「无参调用」——不传 schema 时
 * `validate()` 内部会对 `undefined` 调 `safeParseAsync`，抛
 * `TypeError: Cannot read properties of undefined (reading 'safeParseAsync')`，
 * 该异常会打断表单提交链路，按钮永远停在「登录中...」。
 *
 * ⚠️ 适配器命名陷阱：`sveltekit-superforms/adapters` 里
 *   - `zod`       / `zodClient`   → zod **v3** 适配器
 *   - `zod4`      / `zod4Client`  → zod **v4** 适配器
 * 本项目 zod 是 v4，**两端都必须用 …4 系列**，混用会得到不兼容的校验器。
 */
export const loginSchema = z.object({
	username: z.string().min(1, "请输入用户名"),
	password: z.string().min(1, "请输入密码")
});

/**
 * 表单数据类型（**推导值**，不是 schema 本身的类型）。
 * 注意不能写成 `typeof loginSchema`——那是 ZodObject 的类型，
 * 用在 superforms 的适配器泛型上会得到不匹配的 `Partial<ZodObject<…>>`，
 * 进而导致 `validators` 赋值报错、或校验器类型静默错配。
 */
export type LoginForm = z.infer<typeof loginSchema>;
