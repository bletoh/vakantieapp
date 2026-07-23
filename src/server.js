const express = require('express');
const path = require('path');

const activitiesRouter = require('./routes/activities');
const availabilityRouter = require('./routes/availability');
const agendaRouter = require('./routes/agenda');
const settingsRouter = require('./routes/settings');
const accommodationsRouter = require('./routes/accommodations');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

app.use('/api/activities', activitiesRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/agenda', agendaRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/accommodations', accommodationsRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Vakantieplanner draait op poort ${PORT}`);
});
