// Cálculo de cobro según la tarifa vigente.
// Implementa los modos definidos en schema.sql: minuto | hora | dia | mixto,
// con escalones (paso_minutos_a_horas / paso_horas_a_dias) y redondeo.
function techo(n) { return Math.ceil(n - 1e-9); }

function calcularTotal(tarifa, fechaEntrada, fechaSalida) {
    const entrada = new Date(fechaEntrada);
    const salida = new Date(fechaSalida);
    let minutos = Math.max(0, Math.floor((salida - entrada) / 60000));
    if (minutos === 0) minutos = 1; // cobro mínimo de 1 minuto

    const vMin = Number(tarifa.valor_minuto || 0);
    const vHora = Number(tarifa.valor_hora || 0);
    const vDia = Number(tarifa.valor_dia_completo || 0);
    const modo = tarifa.modo_cobro || 'mixto';
    const pasoMinHora = Number(tarifa.paso_minutos_a_horas || 0);
    const pasoHoraDia = Number(tarifa.paso_horas_a_dias || 0);
    const redHoras = tarifa.redondeo_horas || 'arriba';
    const redDias = tarifa.redondeo_dias || 'arriba';

    const horasBrutas = minutos / 60;
    const diasBrutos = minutos / (60 * 24);

    let total;

    if (modo === 'minuto') {
        total = minutos * vMin;
    } else if (modo === 'hora') {
        const horas = redHoras === 'exacto' ? horasBrutas : techo(horasBrutas);
        total = horas * vHora;
    } else if (modo === 'dia') {
        const dias = redDias === 'exacto' ? diasBrutos : techo(diasBrutos);
        total = dias * vDia;
    } else {
        // mixto: escala de minutos -> horas -> días
        if (pasoHoraDia > 0 && horasBrutas >= pasoHoraDia) {
            const dias = redDias === 'exacto' ? diasBrutos : techo(diasBrutos);
            total = dias * vDia;
        } else if (pasoMinHora > 0 && minutos >= pasoMinHora) {
            const horas = redHoras === 'exacto' ? horasBrutas : techo(horasBrutas);
            total = horas * vHora;
        } else if (pasoMinHora > 0) {
            total = minutos * vMin;
        } else {
            // sin escalones definidos: días completos + horas + minutos residuales
            const dias = Math.floor(minutos / (60 * 24));
            let resto = minutos % (60 * 24);
            const horas = Math.floor(resto / 60);
            resto = resto % 60;
            total = dias * vDia + horas * vHora + resto * vMin;
        }
    }

    return { minutos, total: Math.round(total) };
}

module.exports = { calcularTotal };
