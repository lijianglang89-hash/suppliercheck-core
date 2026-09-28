import Link from "next/link";

import { BUSINESS_SCENARIOS } from "@/lib/content/scenarios";
import { RULE_BY_ID } from "@/lib/reviews/rules";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";

/**
 * 业务场景区块（首页 `#scenarios`）。
 *
 * 每个场景都用同四个字段讲完：谁在做 / 什么时候 / 系统做什么 / 拿到什么。
 * **四格信息结构固定**不是偷懒 —— 访客是在快速扫描「有没有一条说的是我」，
 * 结构一变，他就得重新找位置，扫描就断了。
 *
 * 底部的规则图例是刻意留的：四个场景只覆盖了 15 条规则里的一部分，
 * 不写清楚就容易被读成"产品只有这些能力"。
 */
export function ScenariosSection() {
  return (
    <section
      id="scenarios"
      aria-labelledby="scenarios-heading"
      className="scroll-mt-16 border-b border-ink-200 bg-white"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          业务场景
        </p>
        <h2
          id="scenarios-heading"
          className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 lg:text-3xl"
        >
          这四个时刻，你要的东西其实是同一份
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-600">
          准入、复审、主体核对、扫描件处理 —— 表面上是四件事，
          实际都是「把一包资料摊开，逐条核对，把要处理的挑出来」。
          下面写的每一句都能对应到底部列出的规则编号。
        </p>

        <ul className="mt-10 grid gap-5 lg:grid-cols-2">
          {BUSINESS_SCENARIOS.map((scenario, index) => (
            <Reveal
              as="li"
              key={scenario.id}
              delayMs={index * 60}
              className="card flex flex-col p-6"
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <Icon name={scenario.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-ink-900">{scenario.title}</h3>
                  <p className="mt-1 text-xs font-medium text-ink-500">{scenario.role}</p>
                </div>
              </div>

              <p className="mt-4 rounded-md bg-band px-3 py-2 text-xs leading-5 text-ink-600">
                <span className="font-medium text-ink-800">什么时候用：</span>
                {scenario.trigger}
              </p>

              <ul className="mt-4 space-y-2.5">
                {scenario.steps.map((step) => (
                  <li key={step} className="flex gap-2.5 text-sm leading-6 text-ink-600">
                    <Icon
                      name="check"
                      className="mt-1 h-4 w-4 shrink-0 text-brand-600"
                      aria-hidden="true"
                    />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-sm leading-6 text-ink-800">
                <span className="font-medium">拿到：</span>
                {scenario.outcome}
              </p>

              {/*
                规则编号用等宽字排出来。它们是**可核对的**：同一批编号
                在 `/#rules` 与模板页都能找到对应的中文说明。
                这里刻意不放"效果提升 xx%"之类的修饰。
              */}
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-5">
                {scenario.ruleIds.map((ruleId) => (
                  <li key={ruleId}>
                    <span
                      title={RULE_BY_ID.get(ruleId)?.label ?? ruleId}
                      className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500"
                    >
                      {ruleId}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </ul>

        <p className="mt-8 text-xs leading-5 text-ink-500">
          上列场景引用的是规则库中的一个子集 —— 完整清单（15 条）与逐条判据见下方
          <a href="#rules" className="mx-1 font-medium text-brand-700 hover:underline">
            审核规则
          </a>
          与
          <Link href="/templates" className="mx-1 font-medium text-brand-700 hover:underline">
            资料核验清单
          </Link>
          。
        </p>
      </div>
    </section>
  );
}
