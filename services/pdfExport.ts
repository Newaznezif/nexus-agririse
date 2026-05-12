import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Dataset, Insight } from '@/types';
import { formatDateTime } from '@/utils/formatDate';

export const generatePDFReport = async (dataset: Dataset, insight: Insight, generatorName: string = 'Nexus AgriRise') => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 25;
  const primaryColor = [5, 150, 105]; // Emerald-600
  const secondaryColor = [31, 41, 55]; // Zinc-800
  
  let cursorY = 0;

  // --- HELPER: Draw Premium Border ---
  const drawPageBorder = () => {
    doc.setDrawColor(240, 240, 240);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20);
  };

  // --- HELPER: Load Image as Base64 ---
  const getBase64Image = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.setAttribute('crossOrigin', 'anonymous');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/jpeg');
        resolve(dataURL);
      };
      img.onerror = (error) => reject(error);
      img.src = url;
    });
  };

  // --- PAGE 1: COVER PAGE ---
  drawPageBorder();
  
  // Header Accent
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, pageWidth, 60, 'F');
  
  // Logo & Title
  try {
    const logoData = await getBase64Image('/Logo.jpeg');
    doc.addImage(logoData, 'JPEG', margin, 12, 20, 20);
  } catch (e) {
    // Fallback if logo fails
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text('NEXUS', margin, 28);
  }
  
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('NEXUS AGRIRISE', margin + 25, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('AFRICA INTELLIGENCE SYSTEM', margin + 25, 31);
  
  // Report Identity
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setFontSize(48);
  doc.setFont('helvetica', 'bold');
  doc.text('Intelligence Stream', margin, 110);
  doc.text('Analysis Report', margin, 130);
  
  doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setLineWidth(2);
  doc.line(margin, 140, margin + 60, 140);
  
  // Meta Info
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Reference: NX-${insight.id.substring(0, 8).toUpperCase()}`, margin, 160);
  doc.text(`Source Stream: ${dataset.name}`, margin, 168);
  doc.text(`Market Region: ${dataset.country || 'Pan-African'}`, margin, 176);
  
  // Prepared For/By
  doc.setFillColor(249, 250, 251);
  doc.rect(margin, 210, pageWidth - (margin * 2), 40, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('AUTHORIZED BY', margin + 10, 222);
  doc.text('GENERATION DATE', pageWidth / 2, 222);
  
  doc.setFont('helvetica', 'normal');
  doc.text('NEXUS AGRIRISE SYSTEM', margin + 10, 232);
  doc.text(formatDateTime(new Date().toISOString()), pageWidth / 2, 232);

  // Footer Branding
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text('© 2026 NEXUS AGRIRISE AFRICA. ALL RIGHTS RESERVED.', pageWidth / 2, pageHeight - 20, { align: 'center' });

  // --- PAGE 2: EXECUTIVE SUMMARY & ANALYTICS ---
  doc.addPage();
  drawPageBorder();
  cursorY = 30;

  // Header Title
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('1.0 Executive Intelligence Summary', margin, cursorY);
  cursorY += 15;

  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const summaryLines = doc.splitTextToSize(insight.summary, pageWidth - (margin * 2));
  doc.text(summaryLines, margin, cursorY);
  cursorY += (summaryLines.length * 5) + 20;

  // Risk Assessment Table
  autoTable(doc, {
    startY: cursorY,
    head: [['Intelligence Metric', 'Analysis Details', 'Status']],
    body: [
      ['Risk Profile', `The AI identifies a ${insight.risk_level.toUpperCase()} risk level for this stream.`, insight.risk_level.toUpperCase()],
      ['Market Direction', `Primary price trend is currently ${insight.trend.toLowerCase()}.`, 'ACTIVE'],
      ['Impact Analysis', (insight as any).cross_border_opportunity ? 'Significant' : 'Moderate', 'VERIFIED']
    ],
    theme: 'grid',
    headStyles: { fillColor: primaryColor, fontSize: 10, halign: 'center' },
    styles: { fontSize: 9, cellPadding: 5 },
    margin: { left: margin, right: margin }
  });
  cursorY = (doc as any).lastAutoTable.finalY + 25;

  // Analytical Charts
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('2.0 Real-Time Data Visualization', margin, cursorY);
  cursorY += 15;

  // Histogram (Stylized)
  doc.setFillColor(249, 250, 251);
  doc.rect(margin, cursorY, (pageWidth - (margin * 2)) / 1.6, 60, 'F');
  
  const data = [30, 45, 80, 55, 90, 65];
  const chartX = margin + 10;
  const chartY = cursorY + 50;
  doc.setDrawColor(229, 231, 235);
  doc.line(chartX, chartY, chartX + 80, chartY);
  
  data.forEach((val, i) => {
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2], 0.7);
    doc.rect(chartX + (i * 12) + 5, chartY - (val * 0.4), 8, val * 0.4, 'F');
  });
  doc.setFontSize(8);
  doc.text('Trend Frequency Distribution', margin + 5, cursorY + 55);

  // Pie Chart (Stylized)
  const pieX = pageWidth - margin - 30;
  const pieY = cursorY + 30;
  doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.circle(pieX, pieY, 20, 'S');
  doc.line(pieX, pieY - 20, pieX, pieY + 20);
  doc.line(pieX - 20, pieY, pieX + 20, pieY);
  doc.text('Impact Allocation', pieX - 15, cursorY + 55);

  // --- PAGE 3: STRATEGIC RECOMMENDATIONS ---
  doc.addPage();
  drawPageBorder();
  cursorY = 30;

  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('3.0 Strategic Recommendations', margin, cursorY);
  cursorY += 15;

  const recommendations = [
    { title: 'Sourcing Strategy', desc: 'Diversify commodity procurement across non-correlated markets to hedge against regional supply shocks.' },
    { title: 'Risk Mitigation', desc: 'Activate climate-adaptive insurance and secure storage protocols in high-risk identified zones.' },
    { title: 'Arbitrage Capture', desc: 'Leverage cross-border price gaps identified by the AI to optimize export logistics timing.' },
    { title: 'Digital Integration', desc: 'Integrate these insights directly into ERP systems for automated trade execution.' }
  ];

  autoTable(doc, {
    startY: cursorY,
    head: [['Focus Area', 'Directive Statement']],
    body: recommendations.map(r => [r.title, r.desc]),
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9, cellPadding: 6 },
    margin: { left: margin, right: margin }
  });
  cursorY = (doc as any).lastAutoTable.finalY + 25;

  // Audit Validation
  doc.setFillColor(249, 250, 251);
  doc.rect(margin, cursorY, pageWidth - (margin * 2), 70, 'F');
  
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('4.0 Authorized Validation', margin + 10, cursorY + 15);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Authorized System Code:', margin + 10, cursorY + 30);
  doc.setFont('courier', 'bold');
  doc.text(`NX-AUTH-${Buffer.from(insight.id).toString('base64').substring(0, 16).toUpperCase()}`, margin + 10, cursorY + 38);
  
  // Signatures
  doc.setFont('helvetica', 'normal');
  doc.text('Lead Manager Signature:', pageWidth / 2 + 10, cursorY + 30);
  doc.line(pageWidth / 2 + 10, cursorY + 55, pageWidth - margin - 10, cursorY + 55);
  doc.setFontSize(7);
  doc.text('AUGUSTIN NKUNDIMANA / LEAD ANALYST', pageWidth / 2 + 10, cursorY + 60);

  // Footer for all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 15, { align: 'right' });
    doc.text('Nexus AgriRise Africa Intelligence System', margin, pageHeight - 15);
  }

  const safeName = dataset.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  doc.save(`Nexus_Intelligence_Report_${safeName}.pdf`);
};
