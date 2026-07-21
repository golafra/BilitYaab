/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AirlineConfig } from './types';

export const ALL_AIRLINES: AirlineConfig[] = [
  {
    id: 'iranair',
    name: 'Iran Air',
    nameFa: 'ایران ایر',
    urlTemplate: 'https://ebooking.iranair.com/ibe/IR/home?language=fa#searchResults',
    systemType: 'iranair',
  },
  {
    id: 'sepehran',
    name: 'Sepehran',
    nameFa: 'سپهران',
    urlTemplate: 'https://flysepehran.com/fa/flight/list?departure={origin}&arrival={destination}&departure_date={dateGregorian}&pax=1.0.0&return_date=&datesys=shamsi',
    systemType: 'sepehran',
  },
  {
    id: 'zagros',
    name: 'Zagros',
    nameFa: 'زاگرس',
    urlTemplate: 'https://nrs.zagrosairlines.com/arbaeen/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'kish',
    name: 'Kish Air',
    nameFa: 'کیش ایر',
    urlTemplate: 'https://apps.kishairlines.ir/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsiSlashEncoded}&roundTrip=false&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'qeshm',
    name: 'Qeshm Air',
    nameFa: 'قشم ایر',
    urlTemplate: 'https://apps.qeshm-air.com/arbaeen/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'taban',
    name: 'Taban',
    nameFa: 'تابان',
    urlTemplate: 'https://apps.taban.aero/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'aseman',
    name: 'Aseman',
    nameFa: 'آسمان',
    urlTemplate: 'https://nrs.iaa.ir/arbaeen/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'mahan',
    name: 'Mahan Air',
    nameFa: 'ماهان',
    urlTemplate: 'https://www.mahanair.co.ir/fa/booking/select/{origin}-{destination}?pax={minSeats},0,0&tripType=0&departureDate={timestamp}',
    systemType: 'mahan',
  },
  {
    id: 'iranairtour',
    name: 'Iran Air Tour',
    nameFa: 'ایران ایر تور',
    urlTemplate: 'https://new.iranairtour.ir/flights/list/{origin}-{destination}?departing={dateGregorian}&adult={minSeats}',
    systemType: 'iranairtour',
  },
  {
    id: 'ata',
    name: 'Ata Air',
    nameFa: 'آتا',
    urlTemplate: 'https://app.ataair.ir/flights/{origin}-{destination}?adult={minSeats}&child=0&infant=0&departing={dateShamsi}',
    systemType: 'ata',
  },
  {
    id: 'meraj',
    name: 'Meraj Airlines',
    nameFa: 'معراج',
    urlTemplate: 'https://apps.merajairlines.ir/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'varesh',
    name: 'Varesh Airlines',
    nameFa: 'وارش',
    urlTemplate: 'https://apps.vareshair.ir/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'caspian',
    name: 'Caspian Airlines',
    nameFa: 'کاسپین',
    urlTemplate: 'https://nrs.caspianairlines.com/arbaeen/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'saha',
    name: 'Saha Air',
    nameFa: 'ساها',
    urlTemplate: 'https://nrs.sahaair.com/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'karun',
    name: 'Karun Air',
    nameFa: 'کارون',
    urlTemplate: 'https://nrs.karunair.ir/ibe/Availability?origin={origin}&destination={destination}&departureDate={dateShamsi}&roundTrip=false&returnDate=&adultQty={minSeats}&childQty=0&infantQty=0&foreign=false',
    systemType: 'nira',
  },
  {
    id: 'pars',
    name: 'Pars Holidays',
    nameFa: 'پارس',
    urlTemplate: 'https://www.parsholidays.ir/',
    systemType: 'pars',
  },
];

export function getAirlineUrl(
  airline: AirlineConfig,
  params: {
    origin: string;
    destination: string;
    dateGregorian: string;
    dateShamsi: string;
    minSeats: number;
  }
): string {
  const timestamp = new Date(params.dateGregorian).getTime().toString();
  const dateShamsiSlashEncoded = params.dateShamsi.replace(/-/g, '%2F');

  return airline.urlTemplate
    .replace(/{origin}/g, params.origin)
    .replace(/{destination}/g, params.destination)
    .replace(/{dateGregorian}/g, params.dateGregorian)
    .replace(/{dateShamsi}/g, params.dateShamsi)
    .replace(/{dateShamsiSlashEncoded}/g, dateShamsiSlashEncoded)
    .replace(/{minSeats}/g, params.minSeats.toString())
    .replace(/{timestamp}/g, timestamp);
}
