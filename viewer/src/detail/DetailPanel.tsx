import { forwardRef, useRef, type ReactNode } from "react";
import { Definition } from "../tsql/Definition";
import { CopyButton } from "./CopyButton";
import type { DetailModel, ForeignKeyDetail, ObjectLink } from "./model";
import "./detail.css";

interface DetailPanelProps {
  readonly model: DetailModel;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}

function Flags({ flags }: { flags: readonly string[] }) {
  return flags.length === 0 ? null : (
    <span className="sm-flags">
      {flags.map((flag) => (
        <span key={flag} className="sm-flag">
          {flag}
        </span>
      ))}
    </span>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="sm-detail__section">
      <h3>
        {title}
        {count === undefined ? null : <span className="sm-detail__count"> {String(count)}</span>}
      </h3>
      {children}
    </section>
  );
}

function LinkText({ link, onSelect }: { link: ObjectLink; onSelect: (id: string) => void }) {
  if (link.kind === "text") {
    return <span className="sm-link sm-link--text">{link.label}</span>;
  }
  return (
    <button
      type="button"
      className="sm-link"
      onClick={() => {
        onSelect(link.id);
      }}
    >
      {link.label}
    </button>
  );
}

function LinkList({
  links,
  onSelect,
  empty,
}: {
  links: readonly ObjectLink[];
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (links.length === 0) {
    return <p className="sm-detail__none">{empty}</p>;
  }
  return (
    <ul className="sm-detail__list">
      {links.map((link, i) => (
        <li key={String(i)}>
          <LinkText link={link} onSelect={onSelect} />
          <span className="sm-detail__what"> {link.what}</span>
        </li>
      ))}
    </ul>
  );
}

function Keys({
  keys,
  onSelect,
  empty,
}: {
  keys: readonly ForeignKeyDetail[];
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (keys.length === 0) {
    return <p className="sm-detail__none">{empty}</p>;
  }
  return (
    <ul className="sm-detail__list">
      {keys.map((key) => (
        <li key={key.id}>
          <LinkText link={key.other} onSelect={onSelect} /> <Flags flags={key.flags} />
          <div className="sm-detail__sub">{key.columns}</div>
          <div className="sm-detail__sub">
            {key.name} · on delete {key.onDelete} · on update {key.onUpdate}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ColumnsTable({ model }: { model: DetailModel }) {
  const isTable = model.kind === "table";
  return (
    <div className="sm-detail__scroll">
      <table className="sm-detail__table">
        <caption className="sm-visually-hidden">Columns of {model.qualified}</caption>
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">Type</th>
            <th scope="col">Null</th>
            {isTable ? <th scope="col">Keys</th> : null}
            <th scope="col">Other</th>
          </tr>
        </thead>
        <tbody>
          {model.columns.map((column) => (
            <tr key={column.id}>
              <th scope="row">{column.name}</th>
              <td>{column.type}</td>
              <td>{column.nullable ? "yes" : "no"}</td>
              {isTable ? (
                <td>
                  {[
                    column.isPrimaryKey ? "PK" : null,
                    column.isUnique ? "UQ" : null,
                    column.isForeignKey ? "FK" : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" ")}
                </td>
              ) : null}
              <td>
                {column.identity ? <div>identity</div> : null}
                {column.computed === null ? null : (
                  <div>
                    computed{column.computed.persisted ? " (persisted)" : ""}
                    {column.computed.definition === null ? "" : `: ${column.computed.definition}`}
                  </div>
                )}
                {column.defaultText === null ? null : <div>default {column.defaultText}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableParts({ model }: { model: DetailModel }) {
  return (
    <>
      <Section title="Storage">
        <dl className="sm-detail__facts">
          <dt>Rows</dt>
          <dd>{model.rows}</dd>
          <dt>Size</dt>
          <dd>{model.size}</dd>
        </dl>
      </Section>
      <Section title="Keys" count={model.keyConstraints.length}>
        {model.keyConstraints.length === 0 ? (
          <p className="sm-detail__none">No primary or unique key.</p>
        ) : (
          <ul className="sm-detail__list">
            {model.keyConstraints.map((key) => (
              <li key={key.name}>
                {key.name}
                <div className="sm-detail__sub">
                  {key.kind} ({key.columns})
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Indexes" count={model.indexes.length}>
        {model.indexes.length === 0 ? (
          <p className="sm-detail__none">No indexes.</p>
        ) : (
          <ul className="sm-detail__list">
            {model.indexes.map((index) => (
              <li key={index.id}>
                {index.name}{" "}
                <Flags
                  flags={[
                    index.kind,
                    ...(index.unique ? ["unique"] : []),
                    ...(index.disabled ? ["disabled"] : []),
                  ]}
                />
                <div className="sm-detail__sub">Key: {index.keyColumns.join(", ")}</div>
                {index.includedColumns.length === 0 ? null : (
                  <div className="sm-detail__sub">Included: {index.includedColumns.join(", ")}</div>
                )}
                {index.filter === null ? null : (
                  <div className="sm-detail__sub">Filter: {index.filter}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {model.checks.length === 0 ? null : (
        <Section title="Check constraints" count={model.checks.length}>
          <ul className="sm-detail__list">
            {model.checks.map((check) => (
              <li key={check.name}>
                {check.name} <Flags flags={check.flags} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function DefinitionBlock({ model }: { model: DetailModel }) {
  const ref = useRef<HTMLPreElement>(null);
  const definition = model.definition;
  if (definition === null) {
    return null;
  }
  return (
    <Section title="Definition">
      <p className="sm-detail__reason" data-status={definition.status}>
        <span className="sm-flag">{definition.status.replace("_", " ")}</span> {definition.reason}
      </p>
      {definition.text === null ? null : (
        <>
          <Definition ref={ref} text={definition.text} />
          <CopyButton text={definition.text} label="Copy definition" source={ref} />
        </>
      )}
    </Section>
  );
}

/** The detail panel for one object. Every value comes from the snapshot and is rendered as text. */
export const DetailPanel = forwardRef<HTMLElement, DetailPanelProps>(function DetailPanel(
  { model, onSelect, onClose },
  ref,
) {
  const nameRef = useRef<HTMLHeadingElement>(null);
  return (
    <aside
      ref={ref}
      className="sm-detail"
      aria-label={`Details: ${model.qualified}`}
      tabIndex={-1}
      data-object-kind={model.kind}
    >
      <header className="sm-detail__head">
        <div className="sm-detail__titles">
          <span className="sm-detail__kind">{model.kindLabel}</span>
          <h2 ref={nameRef} className="sm-detail__name">
            {model.qualified}
          </h2>
        </div>
        <CopyButton text={model.qualified} label="Copy name" source={nameRef} />
        <button type="button" className="sm-detail__close" onClick={onClose}>
          Close
        </button>
      </header>
      {model.description === null ? null : <p className="sm-detail__desc">{model.description}</p>}
      {model.parent === null ? null : (
        <p className="sm-detail__desc">
          On <LinkText link={model.parent} onSelect={onSelect} />
        </p>
      )}
      {model.kind === "routine" ? null : (
        <Section title="Columns" count={model.columns.length}>
          <ColumnsTable model={model} />
        </Section>
      )}
      {model.kind === "table" ? <TableParts model={model} /> : null}
      {model.kind === "routine" ? null : (
        <Section title="Relationships">
          <h4>Outgoing foreign keys</h4>
          <Keys keys={model.outgoingKeys} onSelect={onSelect} empty="None." />
          <h4>Incoming foreign keys</h4>
          <Keys keys={model.incomingKeys} onSelect={onSelect} empty="None." />
        </Section>
      )}
      <Section title="Impact">
        <h4>Depends on</h4>
        <LinkList links={model.dependsOn} onSelect={onSelect} empty="Nothing recorded." />
        <h4>Used by</h4>
        <LinkList links={model.usedBy} onSelect={onSelect} empty="Nothing recorded." />
      </Section>
      <DefinitionBlock model={model} />
    </aside>
  );
});
