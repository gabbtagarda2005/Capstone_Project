"use strict";

const { Chart, registerables } = require("chart.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

Chart.register(...registerables);

const BG = "#1f2937";
const GREEN = "#5EE396";
const TICK = "#d1d5db";
const GRID = "#374151";

const chartOpts = {
  width: 580,
  height: 300,
  backgroundColour: BG,
};

/**
 * @param {{ date: string; revenue: number; tickets: number }[]} dailySeries
 * @returns {Promise<Buffer|null>}
 */
async function renderRevenueLineChart(dailySeries) {
  if (!dailySeries?.length) return null;
  try {
    const canvas = new ChartJSNodeCanvas(chartOpts);
    const configuration = {
      type: "line",
      data: {
        labels: dailySeries.map((d) => d.date),
        datasets: [
          {
            label: "Revenue (PHP)",
            data: dailySeries.map((d) => d.revenue),
            borderColor: GREEN,
            backgroundColor: "rgba(94, 227, 150, 0.2)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: GREEN,
          },
        ],
      },
      options: {
        plugins: {
          legend: { labels: { color: TICK } },
          title: {
            display: true,
            text: "Daily revenue (selected range, Manila calendar days)",
            color: TICK,
            font: { size: 14 },
          },
        },
        scales: {
          x: { ticks: { color: TICK, maxRotation: 45 }, grid: { color: GRID } },
          y: { ticks: { color: TICK }, grid: { color: GRID } },
        },
      },
    };
    return await canvas.renderToBuffer(configuration);
  } catch (e) {
    console.warn("[reportPdfCharts] revenue line chart skipped:", e.message);
    return null;
  }
}

/**
 * @param {{ hour: number; tickets: number }[]} hourly
 * @returns {Promise<Buffer|null>}
 */
async function renderHourlyBarChart(hourly) {
  if (!hourly?.length) return null;
  try {
    const canvas = new ChartJSNodeCanvas(chartOpts);
    const labels = hourly.map((h) => `${String(h.hour).padStart(2, "0")}:00`);
    const configuration = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Tickets sold",
            data: hourly.map((h) => h.tickets),
            backgroundColor: GREEN,
            borderColor: "#34d399",
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          legend: { labels: { color: TICK } },
          title: {
            display: true,
            text: "Passenger volume by hour (Manila clock)",
            color: TICK,
            font: { size: 14 },
          },
        },
        scales: {
          x: { ticks: { color: TICK }, grid: { color: GRID } },
          y: { ticks: { color: TICK }, grid: { color: GRID }, beginAtZero: true },
        },
      },
    };
    return await canvas.renderToBuffer(configuration);
  } catch (e) {
    console.warn("[reportPdfCharts] hourly bar chart skipped:", e.message);
    return null;
  }
}

/**
 * @param {Array<{ route: string; tickets: number }>} routes
 * @returns {Promise<Buffer|null>}
 */
async function renderRoutePieChart(routes) {
  if (!routes?.length) return null;
  try {
    const top = routes.slice(0, 6);
    const restTickets = routes.slice(6).reduce((s, r) => s + (Number(r.tickets) || 0), 0);
    const labels = top.map((r) => (r.route.length > 28 ? `${r.route.slice(0, 26)}…` : r.route));
    const data = top.map((r) => Number(r.tickets) || 0);
    if (restTickets > 0) {
      labels.push("Other routes");
      data.push(restTickets);
    }
    if (!data.some((n) => n > 0)) return null;

    const colors = [
      GREEN,
      "#34d399",
      "#6ee7b7",
      "#a7f3d0",
      "#059669",
      "#047857",
      "#9ca3af",
    ];

    const canvas = new ChartJSNodeCanvas(chartOpts);
    const configuration = {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: labels.map((_, i) => colors[i % colors.length]),
            borderColor: BG,
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            position: "right",
            labels: { color: TICK, font: { size: 9 } },
          },
          title: {
            display: true,
            text: "Route share of tickets (top corridors)",
            color: TICK,
            font: { size: 14 },
          },
        },
      },
    };
    return await canvas.renderToBuffer(configuration);
  } catch (e) {
    console.warn("[reportPdfCharts] route pie chart skipped:", e.message);
    return null;
  }
}

module.exports = {
  renderRevenueLineChart,
  renderHourlyBarChart,
  renderRoutePieChart,
};
