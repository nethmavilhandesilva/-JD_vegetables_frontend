import React from 'react';
import SalesReportView from './SalesReportView';

// Full-screen wrapper for the advanced sales report. All filters live inside the report.
const SalesReportModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} role="dialog" aria-modal="true">
      <div className="modal-dialog modal-fullscreen">
        <div className="modal-content" style={{ backgroundColor: '#f4f6f9' }}>
          <SalesReportView onClose={onClose} />
        </div>
      </div>
    </div>
  );
};

export default SalesReportModal;
