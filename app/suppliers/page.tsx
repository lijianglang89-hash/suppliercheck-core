import Link from "next/link";

import { archiveSupplierAction, deleteSupplierAction, restoreSupplierAction } from "@/app/actions/suppliers";
import { SupplierCreateForm, SupplierEditForm, type SupplierFormValues } from "@/components/suppliers/supplier-forms";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { requireActionWorkspace } from "@/lib/auth/action-context";
import { countDocumentsBySupplier } from "@/lib/documents/repository";
import { SUPPLIER_STATUS_LABELS } from "@/lib/reviews/labels";
import { listWorkspaceSuppliers } from "@/lib/suppliers/repository";
import type { Supplier } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "供应商",
  description: "登记供应商主体信息，供资料审核时核对主体一致性。",
};

export default async function SuppliersPage() {
  const { workspace } = await requireActionWorkspace("VIEWER");

  const [suppliers, documentCounts] = await Promise.all([
    listWorkspaceSuppliers(workspace.id, { includeArchived: true }),
    countDocumentsBySupplier(workspace.id),
  ]);

  // 没有归属的资料不计数在任何供应商头上，但仍要如实说明（见页面底部提示）。
  const countBySupplier = new Map<string, number>();
  let unassigned = 0;
  for (const row of documentCounts) {
    if (row.supplierId) countBySupplier.set(row.supplierId, row.total);
    else unassigned = row.total;
  }

  const active = suppliers.filter((supplier) => supplier.status === "ACTIVE");
  const archived = suppliers.filter((supplier) => supplier.status !== "ACTIVE");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">供应商</h1>
        <p className="mt-1 text-sm text-ink-500">
          登记供应商主体。审核时会用这里的名称与统一社会信用代码去核对资料里抽到的主体是否一致。
        </p>
      </header>

      <section
        aria-labelledby="create-supplier-heading"
        className="rounded-lg border border-ink-200 bg-white p-5"
      >
        <h2 id="create-supplier-heading" className="text-sm font-semibold text-ink-900">
          新增供应商
        </h2>
        <div className="mt-4">
          <SupplierCreateForm />
        </div>
      </section>

      <section aria-labelledby="supplier-list-heading" className="space-y-3">
        <h2 id="supplier-list-heading" className="text-sm font-semibold text-ink-900">
          合作中（{active.length}）
        </h2>

        {active.length === 0 ? (
          <p className="rounded-lg border border-ink-200 bg-white px-5 py-8 text-center text-sm text-ink-500">
            还没有登记供应商。供应商不是发起点审核的必要条件 ——
            先用上方表单登记，或直接在<Link href="/reviews" className="mx-1 text-brand-700 hover:underline">资料审核</Link>
            里选择资料发起审核。
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((supplier) => (
              <SupplierCard
                key={supplier.id}
                supplier={supplier}
                documentCount={countBySupplier.get(supplier.id) ?? 0}
              />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading" className="space-y-3">
          <h2 id="archived-heading" className="text-sm font-semibold text-ink-500">
            已归档（{archived.length}）
          </h2>
          <ul className="space-y-3">
            {archived.map((supplier) => (
              <SupplierCard
                key={supplier.id}
                supplier={supplier}
                documentCount={countBySupplier.get(supplier.id) ?? 0}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-ink-500">
        {unassigned > 0
          ? `另有 ${unassigned} 份资料尚未归属到任何供应商，可以在资料库里指定。`
          : "所有资料都已归属到某个供应商。"}
      </p>
    </div>
  );
}

function SupplierCard({
  supplier,
  documentCount,
}: {
  supplier: Supplier;
  documentCount: number;
}) {
  const editValues: SupplierFormValues = {
    name: supplier.name,
    unifiedSocialCreditCode: supplier.unifiedSocialCreditCode ?? "",
    contactName: supplier.contactName ?? "",
    contactPhone: supplier.contactPhone ?? "",
    contactEmail: supplier.contactEmail ?? "",
    region: supplier.region ?? "",
    note: supplier.note ?? "",
  };

  return (
    <li className="rounded-lg border border-ink-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{supplier.name}</p>
          <p className="mt-1 text-xs text-ink-500">
            {supplier.unifiedSocialCreditCode ? (
              <span className="font-mono">{supplier.unifiedSocialCreditCode}</span>
            ) : (
              "未登记统一社会信用代码"
            )}
            {" · "}
            {supplier.region ?? "未填写所在地"}
            {" · "}
            资料 {documentCount} 份
            {" · "}
            {SUPPLIER_STATUS_LABELS[supplier.status] ?? supplier.status}
          </p>
          {supplier.contactName || supplier.contactPhone || supplier.contactEmail ? (
            <p className="mt-0.5 text-xs text-ink-500">
              联系人：{[supplier.contactName, supplier.contactPhone, supplier.contactEmail]
                .filter(Boolean)
                .join(" / ")}
            </p>
          ) : null}
          {supplier.note ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-600">
              {supplier.note}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {supplier.status === "ACTIVE" ? (
            <form action={archiveSupplierAction}>
              <input type="hidden" name="supplierId" value={supplier.id} />
              <ConfirmSubmitButton
                message={`确定归档「${supplier.name}」吗？归档后它不再出现在新建审核的下拉里，但历史审核记录不受影响。`}
              >
                归档
              </ConfirmSubmitButton>
            </form>
          ) : (
            <form action={restoreSupplierAction}>
              <input type="hidden" name="supplierId" value={supplier.id} />
              <ConfirmSubmitButton message={`恢复「${supplier.name}」为合作中？`}>恢复</ConfirmSubmitButton>
            </form>
          )}

          <form action={deleteSupplierAction}>
            <input type="hidden" name="supplierId" value={supplier.id} />
            <ConfirmSubmitButton
              variant="danger"
              message={`删除「${supplier.name}」？该供应商不会再出现在任何列表里；已完成的审核报告仍会保留结论，但会显示为"主体已删除"。`}
            >
              删除
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <details className="border-t border-ink-100">
        <summary className="cursor-pointer px-5 py-2 text-xs font-medium text-ink-600 hover:text-brand-700">
          编辑资料
        </summary>
        <div className="px-5 pb-4">
          <SupplierEditForm supplierId={supplier.id} initial={editValues} />
        </div>
      </details>
    </li>
  );
}
