'use client';

import { useMemo, useState } from 'react';
import { board, objectiveTrend, projects } from '../lib/demo-data';
import { MetricChart } from './metric-chart';

const tabs = [
  'Overview',
  'Board',
  'Goal & Metrics',
  'Experiments',
  'Paper',
  'Review',
  'References',
  'Notes',
  'Lecture',
] as const;
type Tab = (typeof tabs)[number];

const icons: Record<Tab, string> = {
  Overview: '⌂',
  Board: '▦',
  'Goal & Metrics': '◎',
  Experiments: '⌁',
  Paper: '¶',
  Review: '✓',
  References: '⌘',
  Notes: '◇',
  Lecture: '▹',
};

export function ResearchCockpit() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [projectId, setProjectId] = useState<(typeof projects)[number]['id']>(projects[0].id);
  const [autopilot, setAutopilot] = useState<'Bounded' | 'Full'>('Bounded');
  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? projects[0],
    [projectId],
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <strong>GOSU</strong>
            <span>Research OS</span>
          </div>
        </div>
        <button className="lab-switcher">
          <span className="lab-avatar">AI</span>
          <span>
            Alpha Research Lab<small>Owner workspace</small>
          </span>
          <b>⌄</b>
        </button>
        <nav className="nav-list" aria-label="Project navigation">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              <span>{icons[tab]}</span>
              {tab}
              {tab === 'Review' && <em>2</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button>
            <span>◉</span> Approvals <em>3</em>
          </button>
          <button>
            <span>⌁</span> Activity
          </button>
          <button>
            <span>⚙</span> Lab settings
          </button>
          <div className="sync-state">
            <i /> Local-first · Synced <small>Source files stay on your devices</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <select
            value={projectId}
            onChange={(event) => {
              const selected = projects.find((item) => item.id === event.target.value);
              if (selected) setProjectId(selected.id);
            }}
            aria-label="Project"
          >
            {projects.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="top-actions">
            <div className="runner-pill">
              <i /> Runner 01 <span>online</span>
            </div>
            <button className="icon-button" aria-label="Notifications">
              ♢<b>3</b>
            </button>
            <button className="avatar-button">MS</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {project.shortName} / {activeTab}
              </span>
              <h1>{activeTab === 'Overview' ? project.name : activeTab}</h1>
              <p>{subtitle(activeTab)}</p>
            </div>
            <div className="heading-actions">
              <button className="secondary">Share status</button>
              <button className="primary">＋ New experiment</button>
            </div>
          </div>
          {activeTab === 'Overview' && (
            <Overview project={project} autopilot={autopilot} setAutopilot={setAutopilot} />
          )}
          {activeTab === 'Board' && <Board />}
          {activeTab === 'Goal & Metrics' && <GoalMetrics />}
          {activeTab === 'Experiments' && (
            <Experiments autopilot={autopilot} setAutopilot={setAutopilot} />
          )}
          {activeTab === 'Paper' && <Paper />}
          {activeTab === 'Review' && <Review />}
          {activeTab === 'References' && <References />}
          {activeTab === 'Notes' && <Notes />}
          {activeTab === 'Lecture' && <Lecture />}
        </div>
      </section>
    </main>
  );
}

function Overview({
  project,
  autopilot,
  setAutopilot,
}: {
  project: (typeof projects)[number];
  autopilot: 'Bounded' | 'Full';
  setAutopilot: (value: 'Bounded' | 'Full') => void;
}) {
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Primary metric"
          value={project.bestMetric}
          detail={`${project.delta} from baseline`}
          tone="green"
        />
        <Stat label="Active campaign" value="8 / 20" detail="12 trials remaining" />
        <Stat label="Compute budget" value="14.6 h" detail="of 40 GPU-hours" />
        <Stat label="Paper readiness" value="72%" detail="2 review findings open" />
      </div>
      <div className="dashboard-grid">
        <article className="panel chart-panel">
          <PanelHead
            title="Objective progression"
            detail="Validation accuracy · higher is better"
            action="Live"
          />
          <MetricChart points={objectiveTrend} />
          <div className="chart-footer">
            <span>
              <i className="green-dot" /> Best 87.4%
            </span>
            <span>Target 89.0%</span>
            <span>Baseline 83.6%</span>
          </div>
        </article>
        <article className="panel autopilot-panel">
          <PanelHead title="Autopilot" detail="Campaign envelope" />
          <div className="segmented">
            <button
              className={autopilot === 'Bounded' ? 'selected' : ''}
              onClick={() => setAutopilot('Bounded')}
            >
              Bounded
            </button>
            <button
              className={autopilot === 'Full' ? 'selected warning' : ''}
              onClick={() => setAutopilot('Full')}
            >
              Full
            </button>
          </div>
          <div className="autopilot-status">
            <span className="pulse" />
            <div>
              <strong>
                {autopilot === 'Bounded' ? 'Parameter search is running' : 'Full autonomy selected'}
              </strong>
              <small>
                {autopilot === 'Bounded'
                  ? 'Code and protocol changes require approval.'
                  : 'A Project Lead must approve this campaign.'}
              </small>
            </div>
          </div>
          <dl className="limits">
            <div>
              <dt>Max trials</dt>
              <dd>20</dd>
            </div>
            <div>
              <dt>Max concurrency</dt>
              <dd>2</dd>
            </div>
            <div>
              <dt>GPU budget</dt>
              <dd>40 h</dd>
            </div>
            <div>
              <dt>Stop target</dt>
              <dd>89.0%</dd>
            </div>
          </dl>
          <button className="wide-button">Review signed envelope →</button>
        </article>
        <article className="panel activity-panel">
          <PanelHead
            title="Research activity"
            detail="Visible lab workflow only"
            action="View all"
          />
          <Timeline />
        </article>
        <article className="panel approvals-panel">
          <PanelHead title="Needs attention" detail="3 approvals across this project" />
          <Approval
            title="Code change proposal"
            meta="Trial 9 · adapter.py · +18 −6"
            tone="orange"
          />
          <Approval
            title="Evidence candidate"
            meta="Validation accuracy improved by 0.7%"
            tone="green"
          />
          <Approval title="Reviewer request" meta="Results section · 2 comments" tone="blue" />
        </article>
      </div>
    </>
  );
}

function Board() {
  return (
    <div className="board">
      {board.map((column) => (
        <section className="board-column" key={column.title}>
          <header>
            <strong>{column.title}</strong>
            <span>{column.items.length}</span>
          </header>
          {column.items.map((item) => (
            <article className="task-card" key={item.title}>
              <small>{item.tag}</small>
              <h3>{item.title}</h3>
              <footer>
                <span>{item.owner}</span>
                <button>•••</button>
              </footer>
            </article>
          ))}
          <button className="add-card">＋ Add task</button>
        </section>
      ))}
    </div>
  );
}

function GoalMetrics() {
  return (
    <div className="two-column">
      <article className="panel form-panel">
        <PanelHead title="Research objective" detail="Version 3 · locked for active campaign" />
        <label>
          Goal
          <textarea defaultValue="Improve parameter-efficient adaptation while preserving calibration on the held-out validation split." />
        </label>
        <div className="form-row">
          <label>
            Primary metric
            <input defaultValue="validation_accuracy" />
          </label>
          <label>
            Direction
            <select defaultValue="maximize">
              <option>maximize</option>
              <option>minimize</option>
              <option>target</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Baseline
            <input defaultValue="83.6" />
          </label>
          <label>
            Target
            <input defaultValue="89.0" />
          </label>
          <label>
            Unit
            <input defaultValue="%" />
          </label>
        </div>
        <label>
          Evaluator commit
          <input defaultValue="7501463e · eval/accuracy.py" />
        </label>
        <button className="secondary">Create new objective version</button>
      </article>
      <article className="panel">
        <PanelHead title="Hard guardrails" detail="Codex cannot override these limits" />
        <Guard name="Expected calibration error" rule="≤ 0.045" />
        <Guard name="Peak GPU memory" rule="≤ 22 GB" />
        <Guard name="Validation split hash" rule="sha256:4d91…a781" />
        <Guard name="Consecutive failures" rule="≤ 3" />
        <div className="lock-box">
          ▣ Metric, evaluator and holdout are immutable while a campaign is active.
        </div>
      </article>
    </div>
  );
}

function Experiments({
  autopilot,
  setAutopilot,
}: {
  autopilot: 'Bounded' | 'Full';
  setAutopilot: (value: 'Bounded' | 'Full') => void;
}) {
  return (
    <div className="two-column experiment-layout">
      <article className="panel">
        <PanelHead title="Active campaign" detail="campaign_01JQ · Objective v3" action="Running" />
        <div className="run-hero">
          <span className="pulse" />
          <div>
            <strong>Trial 8 · adapter rank 24</strong>
            <small>Runner 01 · 1× NVIDIA GPU · 00:18:42</small>
          </div>
          <b>86%</b>
        </div>
        <MetricChart points={objectiveTrend.slice(0, 8)} />
        <div className="console">
          <span>14:32:08</span> epoch=17 val_accuracy=0.8712
          <br />
          <span>14:32:24</span> epoch=18 val_accuracy=0.8740 <b>best</b>
          <br />
          <span>14:32:25</span> checkpoint committed locally
        </div>
        <div className="button-row">
          <button className="secondary">Pause after trial</button>
          <button className="danger">Stop campaign</button>
        </div>
      </article>
      <article className="panel">
        <PanelHead title="Autonomy & next trial" detail="Signed policy · lead approved" />
        <div className="segmented">
          <button
            className={autopilot === 'Bounded' ? 'selected' : ''}
            onClick={() => setAutopilot('Bounded')}
          >
            Bounded
          </button>
          <button
            className={autopilot === 'Full' ? 'selected warning' : ''}
            onClick={() => setAutopilot('Full')}
          >
            Full
          </button>
        </div>
        <h3 className="proposal-title">Next proposal</h3>
        <p className="proposal">
          Increase adapter rank from 24 to 32 and reduce dropout to 0.08. This remains inside the
          approved parameter envelope.
        </p>
        <dl className="limits">
          <div>
            <dt>Expected impact</dt>
            <dd>+0.2–0.5%</dd>
          </div>
          <div>
            <dt>Estimated cost</dt>
            <dd>1.8 GPU-h</dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd className="safe">Not required</dd>
          </div>
        </dl>
        <button className="wide-button">Inspect manifest</button>
      </article>
    </div>
  );
}

function Paper() {
  return (
    <div className="editor-shell">
      <aside className="file-tree">
        <strong>Manuscript</strong>
        <span>▾ paper</span>
        <button className="selected">¶ main.tex</button>
        <button>¶ methods.tex</button>
        <button>¶ results.tex</button>
        <span>▾ figures</span>
        <button>▧ accuracy.pdf</button>
        <button>⌘ references.bib</button>
      </aside>
      <article className="code-editor">
        <header>
          <span>results.tex</span>
          <b>working/paper-eva</b>
        </header>
        <pre>
          <i>41</i>
          <code>{`\\section{Results}`}</code>
          <i>42</i>
          <code></code>
          <i>43</i>
          <code>{`Our approach reaches \\textbf{87.4\\%} validation`}</code>
          <i>44</i>
          <code>{`accuracy, improving the locked baseline by 3.8 points.`}</code>
          <i>45</i>
          <code>{`This result is linked to \\gosurun{trial-08}.`}</code>
          <i>46</i>
          <code></code>
          <i>47</i>
          <code>{`\\cite{verified:lin2025adapter}`}</code>
        </pre>
        <div className="ai-diff">
          AI suggestion · lineage verified <button>Reject</button>
          <button className="accept">Accept patch</button>
        </div>
      </article>
      <article className="pdf-preview">
        <header>
          Compiled preview <span>✓ 0 errors</span>
        </header>
        <div className="paper-page">
          <small>4. RESULTS</small>
          <p>
            Our approach reaches <b>87.4% validation accuracy</b>, improving the locked baseline by
            3.8 points.
          </p>
          <div className="fake-figure">
            <span>Accuracy</span>
            <div />
          </div>
          <small>Figure 2. Objective progression across approved trials.</small>
        </div>
      </article>
    </div>
  );
}

function Review() {
  return (
    <div className="two-column">
      <article className="panel">
        <PanelHead title="Review round 2" detail="Commit 7501463e · 2 open findings" />
        <Approval
          title="[Human] Clarify comparison protocol"
          meta="results.tex · lines 43–48 · changes requested"
          tone="orange"
        />
        <Approval
          title="[AI] Citation only has metadata"
          meta="limitations.tex · line 17 · blocks Full mode"
          tone="blue"
        />
        <Approval
          title="[Human] Figure caption resolved"
          meta="figures.tex · approved by SK"
          tone="green"
        />
      </article>
      <article className="panel">
        <PanelHead title="Decision gate" detail="Only human reviewers can approve" />
        <div className="review-score">
          <b>7 / 9</b>
          <span>checks passing</span>
        </div>
        <Guard name="LaTeX compile" rule="Pass" />
        <Guard name="Verified citations" rule="1 blocked" />
        <Guard name="Run lineage" rule="Pass" />
        <button className="primary wide-button" disabled>
          Approve revision
        </button>
      </article>
    </div>
  );
}

function References() {
  return (
    <div className="two-column">
      <article className="panel">
        <PanelHead
          title="Zotero library"
          detail="Read-only local mirror · synced 4 min ago"
          action="Refresh"
        />
        <input className="search" placeholder="Search title, author, DOI…" />
        <Reference
          title="Parameter-Efficient Adaptation for Vision Models"
          meta="Lin et al. · 2025 · DOI verified"
          status="Full text verified"
        />
        <Reference
          title="Calibration under Distribution Shift"
          meta="Rao & Kim · 2024 · DOI verified"
          status="Metadata only"
        />
        <Reference
          title="Reliable Evaluation Protocols"
          meta="Singh et al. · 2023 · arXiv verified"
          status="Full text verified"
        />
      </article>
      <article className="panel">
        <PanelHead title="Citation manifest" detail="Generated into GitHub working tree" />
        <pre className="manifest">{`provider: zotero\nlibrary: group:alpha-lab\nitems:\n  - lin2025adapter\n  - rao2024calibration\ncommit: 7501463e`}</pre>
        <button className="wide-button">Generate references.bib</button>
      </article>
    </div>
  );
}

function Notes() {
  return (
    <div className="two-column">
      <article className="panel">
        <PanelHead
          title="Obsidian vault"
          detail="Read-only · never uploaded"
          action="Choose folder"
        />
        <div className="note-list">
          <button className="active">Experiment ideas.md</button>
          <button>Weekly notes/2026-08-03.md</button>
          <button>Paper outline.md</button>
        </div>
      </article>
      <article className="panel markdown">
        <span className="eyebrow">LOCAL MARKDOWN</span>
        <h2>Experiment ideas</h2>
        <p>
          Test whether increasing adapter rank improves validation accuracy without degrading
          calibration.
        </p>
        <h3>Linked evidence</h3>
        <ul>
          <li>[[Trial 8]] reached 87.4%</li>
          <li>Compare against [[Locked baseline v3]]</li>
        </ul>
        <div className="lock-box">This note stays in your selected Obsidian folder.</div>
      </article>
    </div>
  );
}

function Lecture() {
  return (
    <div className="two-column">
      <article className="panel">
        <PanelHead title="Lecture draft" detail="Generated from approved manuscript revisions" />
        <label>
          Audience
          <select>
            <option>Graduate ML seminar</option>
            <option>Undergraduate introduction</option>
          </select>
        </label>
        <label>
          Duration
          <select>
            <option>45 minutes · 14 slides</option>
            <option>20 minutes · 8 slides</option>
          </select>
        </label>
        <label>
          Source revisions<div className="source-chip">✓ EVA paper · revision 12 · approved</div>
        </label>
        <button className="primary wide-button">Generate slide outline</button>
      </article>
      <article className="panel slide-preview">
        <span>03 / 14</span>
        <h2>Why parameter-efficient adaptation?</h2>
        <div className="slide-columns">
          <ul>
            <li>Full fine-tuning is expensive</li>
            <li>Adapters isolate task-specific parameters</li>
            <li>Evaluation must include calibration</li>
          </ul>
          <div className="slide-metric">
            <b>87.4%</b>
            <small>best validation accuracy</small>
          </div>
        </div>
        <footer>Sources: manuscript §2 · trial-08 · lin2025adapter</footer>
      </article>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function PanelHead({ title, detail, action }: { title: string; detail: string; action?: string }) {
  return (
    <header className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action && <button>{action}</button>}
    </header>
  );
}
function Approval({ title, meta, tone }: { title: string; meta: string; tone: string }) {
  return (
    <div className="approval">
      <i className={tone} />
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <button>→</button>
    </div>
  );
}
function Guard({ name, rule }: { name: string; rule: string }) {
  return (
    <div className="guard">
      <span>✓</span>
      <strong>{name}</strong>
      <b>{rule}</b>
    </div>
  );
}
function Reference({ title, meta, status }: { title: string; meta: string; status: string }) {
  return (
    <div className="reference">
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <span>{status}</span>
      <button>Cite</button>
    </div>
  );
}
function Timeline() {
  return (
    <div className="timeline">
      <div>
        <i />
        <span>
          <b>Trial 8 reached a new best metric</b>
          <small>87.4% · 6 minutes ago · Runner 01</small>
        </span>
      </div>
      <div>
        <i />
        <span>
          <b>Codex proposed the next parameter set</b>
          <small>Inside approved envelope · 7 minutes ago</small>
        </span>
      </div>
      <div>
        <i />
        <span>
          <b>Review comment resolved by Min-suk</b>
          <small>results.tex · 24 minutes ago</small>
        </span>
      </div>
      <div>
        <i />
        <span>
          <b>Objective protocol v3 was locked</b>
          <small>Approved by Project Lead · yesterday</small>
        </span>
      </div>
    </div>
  );
}

function subtitle(tab: Tab) {
  const descriptions: Record<Tab, string> = {
    Overview: 'One traceable loop from goal to experiment, evidence, and paper.',
    Board: 'Coordinate project work without separating it from research evidence.',
    'Goal & Metrics': 'Lock the metric contract before autonomous work begins.',
    Experiments: 'Execute approved trials on your lab-owned compute.',
    Paper: 'Write against Git commits and verified research lineage.',
    Review: 'Human decisions remain the final research gate.',
    References: 'Cite from a verified, read-only reference mirror.',
    Notes: 'Read local Obsidian knowledge without uploading the vault.',
    Lecture: 'Turn approved revisions into source-linked slide drafts.',
  };
  return descriptions[tab];
}
