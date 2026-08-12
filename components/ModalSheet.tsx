"use client";
export default function ModalSheet({children, onClose}: {children: React.ReactNode; onClose: () => void}) {
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className="action-sheet drawer" onClick={(e) => e.stopPropagation()}>{children}</section>
  </div>
}