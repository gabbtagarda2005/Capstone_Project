type Props = { title: string; subtitle?: string };

export function PlaceholderPage({ title, subtitle }: Props) {
  return (
    <div className="admin-placeholder">
      <h1>{title}</h1>
      <p>{subtitle ?? "This section is coming soon."}</p>
    </div>
  );
}
