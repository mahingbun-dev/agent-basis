/**
 * worker 检查器 · 视图五(38 号 T12;30 号 §2 视图 5):单 worker 深视图四
 * 要素——子代理树(27 号三层权力结构的实况,W-2 不增层)、运行中 jobs、工具
 * 调用历史、上下文占用 % 与成本累计(R1 预算数据,W-3)。
 *
 * 受控纯组件(渲染测试直驱;38 号 G-11);布局/文案 = 原型 03 视图五
 * (docs/prototypes/03-workbench-views.html #v5)逐字。M3 数据 = mock 快照
 * worker 节(worker-updated 增量驱动);M4 换上游 session/jobs 事件源(W-4)。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { workerInspectorView, type WorkerInspectorView } from '../project/worker-view.ts'
import type { WorkerInspectorSnapshot, WorkerTreeNode } from '../types.ts'

export interface WorkerInspectorProps {
  readonly snapshot: WorkerInspectorSnapshot
}

const TREE_DOT: Readonly<Record<WorkerTreeNode['state'], string>> = {
  idle: 'idle',
  working: 'working',
  queued: 'queued',
  ready: 'ready',
}

/** 树节点(递归;W-2 三层封闭——数据面深度由 workerTreeDepth 断言钳制)。 */
function TreeNode({ node, depth }: { readonly node: WorkerTreeNode; readonly depth: number }): ReactElement {
  return (
    <li>
      <span
        data-eterna-workbench="tree-node"
        data-eterna-workbench-current={node.current === true ? 'true' : undefined}
        data-eterna-workbench-depth={String(depth)}
      >
        <span data-eterna-workbench="dot" data-eterna-workbench-dot={TREE_DOT[node.state]} aria-hidden="true" />
        <span>{node.name}</span>
        <span data-eterna-workbench="tree-role">{node.role}</span>
      </span>
      {(node.children ?? []).length > 0 && (
        <ul>
          {(node.children ?? []).map(child => <TreeNode key={child.name} node={child} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  )
}

function Meter({ meter, withThreshold }: {
  readonly meter: WorkerInspectorView['contextMeter'] | WorkerInspectorView['costMeter']
  readonly withThreshold: boolean
}): ReactElement {
  return (
    <div data-eterna-workbench="stat-card">
      <p data-eterna-workbench="metric-label">{meter.label}</p>
      <div data-eterna-workbench="meter-wrap">
        <p data-eterna-workbench="meter" role="img" aria-label={meter.aria}>
          <span data-eterna-workbench="meter-fill" data-eterna-workbench-fill={`${meter.percent}%`} style={{ width: `${meter.percent}%` }} />
        </p>
        {withThreshold && meter.thresholdPercent !== undefined && (
          <span
            data-eterna-workbench="meter-threshold"
            data-eterna-workbench-at={`${meter.thresholdPercent}%`}
            style={{ left: `${meter.thresholdPercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <p data-eterna-workbench="metric-sub">{meter.note}</p>
    </div>
  )
}

/** 视图五 · worker 检查器(原型 03 #v5:头卡 + 子代理树/jobs 左列 + 工具史/上下文成本右列)。 */
export function WorkerInspector({ snapshot }: WorkerInspectorProps): ReactElement {
  const view = workerInspectorView(snapshot)
  return (
    <section data-eterna-workbench="view" data-eterna-workbench-view="worker" id="wb-v5" aria-labelledby="wb-h-v5">
      <div data-eterna-workbench="view-head">
        <h2 data-eterna-workbench="view-title" id="wb-h-v5">worker 检查器 · 单 worker 深视图</h2>
      </div>
      <p data-eterna-workbench="view-desc">查看执行者的实时状态：任务分工、进行中的后台作业、工具调用历史，以及上下文与成本占用。</p>

      <div data-eterna-workbench="inspector-head">
        <p data-eterna-workbench="inspector-title"><Icon name="worker" size={20} />worker <span data-eterna-workbench-seg-mono="true">{view.head.id}</span></p>
        <ul data-eterna-workbench="inspector-meta">
          <li>工单 <span data-eterna-workbench-seg-mono="true">{view.head.ticketId}</span></li>
          <li>运行 <span data-eterna-workbench-num="true">{view.head.runMinutes}</span></li>
          <li>{view.head.presetNote}</li>
          <li>槽位 <span data-eterna-workbench-num="true">{view.head.slots}</span></li>
          <li>域包 <span data-eterna-workbench-seg-mono="true">{view.head.domainPack}</span></li>
        </ul>
      </div>

      <div data-eterna-workbench="inspector">
        <div data-eterna-workbench="inspector-col">
          <h3 data-eterna-workbench="sub-h">任务分工树</h3>
          <ul data-eterna-workbench="tree">
            <TreeNode node={snapshot.tree} depth={0} />
          </ul>
          <p data-eterna-workbench="tree-note">{view.treeNote}</p>

          <h3 data-eterna-workbench="sub-h">{`运行中 jobs（${view.jobsRunning.length}）`}</h3>
          <ul data-eterna-workbench="job-list" data-eterna-workbench-jobs="running">
            {view.jobsRunning.map(job => (
              <li key={job.id} data-eterna-workbench="job-item">
                <span data-eterna-workbench="dot" data-eterna-workbench-dot="working" aria-hidden="true" />
                <span data-eterna-workbench="job-body">
                  <span data-eterna-workbench="job-name">{job.name}</span>
                  <span data-eterna-workbench="job-meta">{job.meta}</span>
                </span>
              </li>
            ))}
          </ul>
          <details data-eterna-workbench="jobs-done">
            <summary><Icon name="chevron-right" size={16} />{`已结束 jobs（${view.jobsDone.length}）`}</summary>
            <ul data-eterna-workbench="job-list" data-eterna-workbench-jobs="done">
              {view.jobsDone.map(job => (
                <li key={job.id} data-eterna-workbench="job-item">
                  <span data-eterna-workbench="dot" data-eterna-workbench-dot="ready" aria-hidden="true" />
                  <span data-eterna-workbench="job-body">
                    <span data-eterna-workbench="job-name">{job.name}</span>
                    <span data-eterna-workbench="job-meta">{job.meta}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <div data-eterna-workbench="inspector-col">
          <h3 data-eterna-workbench="sub-h">工具调用历史</h3>
          <div data-eterna-workbench="table-scroll">
            <table>
              <caption>{`worker ${view.head.id} · 本工单`}</caption>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">工具</th>
                  <th scope="col">参数摘要</th>
                  <th scope="col">状态</th>
                  <th scope="col">耗时</th>
                </tr>
              </thead>
              <tbody>
                {view.toolRows.map(row => (
                  <tr key={row.id} data-eterna-workbench="tool-row" data-eterna-workbench-tool={row.tool}>
                    <td data-eterna-workbench-num="true">{row.time}</td>
                    <td data-eterna-workbench-seg-mono="true">{row.tool}</td>
                    <td>{row.params}</td>
                    <td><span data-eterna-workbench="badge" data-eterna-workbench-tone={row.status.tone}>{row.status.label}</span></td>
                    <td data-eterna-workbench-num="true">{row.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 data-eterna-workbench="sub-h">上下文占用与成本</h3>
          <div data-eterna-workbench="stat-grid">
            <Meter meter={view.contextMeter} withThreshold />
            <Meter meter={view.costMeter} withThreshold={false} />
          </div>
        </div>
      </div>
    </section>
  )
}
