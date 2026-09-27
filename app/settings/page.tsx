import { PasswordForm, ProfileForm, WorkspaceNameForm } from "@/components/settings/settings-forms";
import { MOCK_DISCLAIMER, MOCK_PROVIDER_ID } from "@/lib/ai";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { roleAtLeast } from "@/lib/auth/workspace-access";
import { getEnv } from "@/lib/config/server-env";
import { ABSOLUTE_MAX_UPLOAD_BYTES } from "@/lib/documents/limits";
import { formatBytes } from "@/lib/files";
import {
  MAX_DOCUMENTS_PER_RUN,
  MAX_TOTAL_REVIEW_CHARS,
  REVIEW_TIMEOUT_MS,
} from "@/lib/reviews/limits";
import { REVIEW_RULES } from "@/lib/reviews/rules";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "设置",
  description: "工作区、账号与审核引擎的运行配置。",
};

const ROLE_LABELS: Record<string, string> = {
  OWNER: "所有者",
  ADMIN: "管理员",
  MEMBER: "成员",
  VIEWER: "只读成员",
};

export default async function SettingsPage() {
  const { workspace, user, role } = await requireActionWorkspace("VIEWER");
  const env = getEnv();
  const aiIsMock = env.AI_PROVIDER === MOCK_PROVIDER_ID;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">设置</h1>
        <p className="mt-1 text-sm text-ink-500">
          当前账号：{user.email} · 角色 {ROLE_LABELS[role] ?? role}
        </p>
      </header>

      <section
        aria-labelledby="workspace-heading"
        className="card p-5"
      >
        <h2 id="workspace-heading" className="text-sm font-semibold text-ink-900">
          工作区
        </h2>
        <div className="mt-4">
          <WorkspaceNameForm initialName={workspace.name} canEdit={roleAtLeast(role, "ADMIN")} />
        </div>
      </section>

      <section
        aria-labelledby="profile-heading"
        className="card p-5"
      >
        <h2 id="profile-heading" className="text-sm font-semibold text-ink-900">
          账号资料
        </h2>
        <div className="mt-4">
          <ProfileForm initialDisplayName={user.displayName ?? ""} />
        </div>
      </section>

      <section
        aria-labelledby="password-heading"
        className="card p-5"
      >
        <h2 id="password-heading" className="text-sm font-semibold text-ink-900">
          修改密码
        </h2>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>

      <section
        aria-labelledby="engine-heading"
        className="card p-5"
      >
        <h2 id="engine-heading" className="text-sm font-semibold text-ink-900">
          审核引擎
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          以下为当前部署的实际运行参数，来自服务端环境变量，页面上不可修改。
        </p>

        <dl className="mt-4 divide-y divide-ink-100 text-sm">
          <Row label="审核方式" value="确定性规则引擎">
            <span className="block text-xs text-ink-500">
              共 {REVIEW_RULES.length} 条规则，纯函数执行：同样的资料必然得到同样的结论，
              不调用外部模型、不联网。
            </span>
          </Row>
          <Row label="AI 复核" value={aiIsMock ? "未启用" : "已启用"}>
            <span className="block text-xs text-ink-500">
              {aiIsMock
                ? MOCK_DISCLAIMER + " 未接入真实模型前，所有结论均来自规则引擎，不含 AI 推测。"
                : `Provider ${env.AI_PROVIDER}${env.AI_MODEL ? ` · 模型 ${env.AI_MODEL}` : ""}。AI 结论单独标注来源，且严重级别上限为「中」，只作提示不作定性。`}
            </span>
          </Row>
          <Row label="文件存储" value={env.STORAGE_PROVIDER === "local" ? "本地私有目录" : env.STORAGE_PROVIDER}>
            <span className="block text-xs text-ink-500">
              文件不产生任何公开链接，只能通过登录后的授权接口下载。
            </span>
          </Row>
          <Row label="单文件上传上限" value={formatBytes(env.MAX_UPLOAD_BYTES)}>
            <span className="block text-xs text-ink-500">
              硬上限 {formatBytes(ABSOLUTE_MAX_UPLOAD_BYTES)}，即使环境变量配得更大也不会突破。
            </span>
          </Row>
          <Row label="单次审核资料数上限" value={`${MAX_DOCUMENTS_PER_RUN} 份`}>
            <span className="block text-xs text-ink-500">
              单次审核的正文总量上限 {(MAX_TOTAL_REVIEW_CHARS / 10_000).toLocaleString("zh-CN")} 万字，
              超出部分会被截断并在报告里如实标注。
            </span>
          </Row>
          <Row label="单次审核超时" value={`${Math.round(REVIEW_TIMEOUT_MS / 1000)} 秒`}>
            <span className="block text-xs text-ink-500">
              文档解析与审核共用同一条串行队列，避免内存峰值叠加。
            </span>
          </Row>
        </dl>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-ink-900">
        <span className="font-medium">{value}</span>
        {children}
      </dd>
    </div>
  );
}
