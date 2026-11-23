import type { ProjectSnapshot } from '../store/projectDocument.ts';
import type { Instance } from '../store/useStore.ts';

/**
 * Generates a realistic CMOS Image Sensor (CIS) floorplan with a 25 um seal-ring
 * inset, active pixel array, analog/digital macro IPs, 40 perimeter I/O pads,
 * and reference rulers. Every coordinate is grid-aligned and overlap-free.
 */
export const createCisDemoProject = (): ProjectSnapshot => {
  const libName = 'cis_demo_lib';
  const masterCells: ProjectSnapshot['masterCells'] = {
    m_rowdrv: {
      id: 'm_rowdrv',
      libName,
      cellName: 'ROW_DRV',
      width: 160,
      height: 960,
      color: '#0ea5e9',
      opacity: 0.52,
      outlineStyle: 'solid',
    },
    m_coladc: {
      id: 'm_coladc',
      libName,
      cellName: 'COL_ADC_BANK',
      width: 760,
      height: 180,
      color: '#2563eb',
      opacity: 0.55,
      outlineStyle: 'solid',
    },
    m_isp: {
      id: 'm_isp',
      libName,
      cellName: 'ISP_CORE',
      width: 680,
      height: 160,
      color: '#7c3aed',
      opacity: 0.52,
      outlineStyle: 'solid',
    },
    m_pll: {
      id: 'm_pll',
      libName,
      cellName: 'PLL_BG',
      width: 180,
      height: 260,
      color: '#14b8a6',
      opacity: 0.55,
      outlineStyle: 'solid',
    },
    m_mipi: {
      id: 'm_mipi',
      libName,
      cellName: 'MIPI_TX_4L',
      width: 180,
      height: 440,
      color: '#f97316',
      opacity: 0.55,
      outlineStyle: 'solid',
    },
    m_pmu: {
      id: 'm_pmu',
      libName,
      cellName: 'LDO_PMU',
      width: 240,
      height: 160,
      color: '#ec4899',
      opacity: 0.52,
      outlineStyle: 'solid',
    },
    m_ctrl: {
      id: 'm_ctrl',
      libName,
      cellName: 'I2C_SPI_CTRL',
      width: 240,
      height: 160,
      color: '#22c55e',
      opacity: 0.52,
      outlineStyle: 'solid',
    },
    m_pad: {
      id: 'm_pad',
      libName,
      cellName: 'IO_PAD_60',
      width: 60,
      height: 60,
      color: '#f59e0b',
      kind: 'pad',
      opacity: 0.65,
      outlineStyle: 'solid',
    },
  };

  const instances: Instance[] = [
    { id: 'inst_rowdrv', cellId: 'm_rowdrv', name: 'I_ROW_DRV', x: -1020, y: -330, orientation: 'R0' },
    { id: 'inst_adc_l', cellId: 'm_coladc', name: 'I_ADC_LEFT', x: -800, y: -580, orientation: 'R0' },
    { id: 'inst_adc_r', cellId: 'm_coladc', name: 'I_ADC_RIGHT', x: 40, y: -580, orientation: 'R0' },
    { id: 'inst_isp', cellId: 'm_isp', name: 'I_ISP_CORE', x: -340, y: -790, orientation: 'R0' },
    { id: 'inst_pll', cellId: 'm_pll', name: 'I_PLL_BG', x: 860, y: 240, orientation: 'R0' },
    { id: 'inst_mipi', cellId: 'm_mipi', name: 'I_MIPI_TX', x: 860, y: -280, orientation: 'R0' },
    { id: 'inst_pmu', cellId: 'm_pmu', name: 'I_LDO_PMU', x: -1020, y: -790, orientation: 'R0' },
    { id: 'inst_ctrl', cellId: 'm_ctrl', name: 'I_CTRL', x: 780, y: -790, orientation: 'R0' },
  ];

  // Top edge pads (12 pads, R0, top edge at +875 -> y = 815)
  for (let i = 0; i < 12; i += 1) {
    instances.push({
      id: `pad_t_${i}`,
      cellId: 'm_pad',
      name: `PAD_T${i}`,
      x: -690 + i * 120,
      y: 815,
      orientation: 'R0',
    });
  }

  // Bottom edge pads (12 pads, R180, bottom edge at -875 -> y = -815)
  for (let i = 0; i < 12; i += 1) {
    instances.push({
      id: `pad_b_${i}`,
      cellId: 'm_pad',
      name: `PAD_B${i}`,
      x: -630 + i * 120,
      y: -815,
      orientation: 'R180',
    });
  }

  // Left edge pads (8 pads, R90, left edge at -1175 -> x = -1115)
  for (let i = 0; i < 8; i += 1) {
    instances.push({
      id: `pad_l_${i}`,
      cellId: 'm_pad',
      name: `PAD_L${i}`,
      x: -1115,
      y: -520 + i * 140,
      orientation: 'R90',
    });
  }

  // Right edge pads (8 pads, R270, right edge at +1175 -> x = 1115)
  for (let i = 0; i < 8; i += 1) {
    instances.push({
      id: `pad_r_${i}`,
      cellId: 'm_pad',
      name: `PAD_R${i}`,
      x: 1115,
      y: -460 + i * 140,
      orientation: 'R270',
    });
  }

  return {
    gridSize: 0.005,
    topWidth: 2400,
    topHeight: 1800,
    topLibName: libName,
    topCellName: 'cis_top_2mp',
    padInset: 25,
    masterCells,
    instances,
    rulers: [
      { id: 'ruler_row_gap', startX: -860, startY: 150, endX: -800, endY: 150 },
      { id: 'ruler_adc_gap', startX: -400, startY: -400, endX: -400, endY: -350 },
    ],
    pixelArray: {
      x: -800,
      y: -350,
      width: 1600,
      height: 1000,
      visible: true,
    },
  };
};
