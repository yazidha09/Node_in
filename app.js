const express = require('express');
const { engine } = require('express-handlebars');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const { check, validationResult } = require('express-validator');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Handlebars setup
app.engine('handlebars', engine({ 
  defaultLayout: 'main',
  helpers: {
    eq: function(v1, v2) {
      return v1 === v2;
    },
    formatDate: function(date) {
      const d = new Date(date);
      return d.toLocaleDateString('fr-FR');
    }
  }
}));
app.set('view engine', 'handlebars');
app.set('views', './views');

// Database connection - d'abord se connecter sans spécifier de base de données
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: ''
});

// Connect to MySQL
connection.connect((err) => {
  if (err) {
    console.error('Erreur de connexion à MySQL:', err);
    return;
  }
  console.log('Connecté à MySQL');
  
  // Créer la base de données si elle n'existe pas
  connection.query('CREATE DATABASE IF NOT EXISTS systeme_stages', (err) => {
    if (err) {
      console.error('Erreur lors de la création de la base de données:', err);
      return;
    }
    console.log('Base de données systeme_stages créée ou déjà existante');
    
    // Se reconnecter avec la base de données sélectionnée
    connection.end();
    
    const db = mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'systeme_stages'
    });
    
    // Reconnexion avec la base sélectionnée
    db.connect((err) => {
      if (err) {
        console.error('Erreur de connexion à la base de données:', err);
        return;
      }
      console.log('Connecté à la base de données systeme_stages');
      
      // Créer la table stagiaires si elle n'existe pas
      const sql = `CREATE TABLE IF NOT EXISTS stagiaires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        telephone VARCHAR(20) NOT NULL,
        niveauEtudes VARCHAR(50) NOT NULL,
        specialite VARCHAR(100) NOT NULL,
        dateDebut DATE NOT NULL,
        dateFin DATE NOT NULL,
        dateInscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
      
      db.query(sql, (err) => {
        if (err) {
          console.error('Erreur lors de la création de la table:', err);
          return;
        }
        console.log('Table stagiaires créée ou déjà existante');
      });
      
      // Remplacer la référence à db dans le scope global
      global.db = db;
    });
  });
});

// Créer une référence db dans le scope global pour les routes
let db;

// Validation rules
const stagiaireValidationRules = [
  check('nom').notEmpty().withMessage('Le nom est obligatoire').trim().escape(),
  check('prenom').notEmpty().withMessage('Le prénom est obligatoire').trim().escape(),
  check('email').isEmail().withMessage('Adresse email invalide').normalizeEmail(),
  check('telephone').notEmpty().withMessage('Le téléphone est obligatoire')
    .matches(/^[0-9+\s]+$/).withMessage('Format de téléphone invalide'),
  check('niveauEtudes').notEmpty().withMessage('Le niveau d\'études est obligatoire'),
  check('specialite').notEmpty().withMessage('La spécialité est obligatoire'),
  check('dateDebut').isDate().withMessage('Date de début invalide'),
  check('dateFin').isDate().withMessage('Date de fin invalide')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.dateDebut)) {
        throw new Error('La date de fin doit être postérieure à la date de début');
      }
      return true;
    })
];

// Routes
app.get('/', (req, res) => {
  res.render('accueil');
});

app.get('/inscription', (req, res) => {
  res.render('inscription');
});

app.post('/inscription', stagiaireValidationRules, (req, res) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.render('inscription', { 
      errors: errors.array(),
      stagiaire: req.body
    });
  }

  const stagiaire = {
    nom: req.body.nom,
    prenom: req.body.prenom,
    email: req.body.email,
    telephone: req.body.telephone,
    niveauEtudes: req.body.niveauEtudes,
    specialite: req.body.specialite,
    dateDebut: req.body.dateDebut,
    dateFin: req.body.dateFin
  };

  global.db.query('INSERT INTO stagiaires SET ?', stagiaire, (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.render('inscription', { 
          errors: [{ msg: 'Cette adresse email est déjà utilisée' }],
          stagiaire: req.body
        });
      }
      console.error('Erreur lors de l\'enregistrement:', err);
      return res.render('inscription', { 
        errors: [{ msg: 'Erreur lors de l\'enregistrement, veuillez réessayer' }],
        stagiaire: req.body
      });
    }
    
    res.redirect('/liste');
  });
});

app.get('/liste', (req, res) => {
  global.db.query('SELECT * FROM stagiaires ORDER BY dateInscription DESC', (err, stagiaires) => {
    if (err) {
      console.error('Erreur lors de la récupération des stagiaires:', err);
      return res.render('liste', { error: 'Erreur lors de la récupération des stagiaires' });
    }
    
    res.render('liste', { stagiaires });
  });
});

// Route pour exporter la liste des stagiaires en CSV
app.get('/export-csv', (req, res) => {
  global.db.query('SELECT * FROM stagiaires ORDER BY nom ASC', (err, stagiaires) => {
    if (err) {
      console.error('Erreur lors de la récupération des stagiaires:', err);
      return res.status(500).send('Erreur lors de la génération du CSV');
    }
    
    // Définir les en-têtes pour le téléchargement du CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=liste_stagiaires.csv');
    
    // En-tête CSV
    let csv = 'Nom,Prénom,Email,Téléphone,Niveau d\'études,Spécialité,Date de début,Date de fin\n';
    
    // Ajouter les données
    stagiaires.forEach(stagiaire => {
      const dateDebut = new Date(stagiaire.dateDebut).toLocaleDateString('fr-FR');
      const dateFin = new Date(stagiaire.dateFin).toLocaleDateString('fr-FR');
      
      csv += `"${stagiaire.nom}","${stagiaire.prenom}","${stagiaire.email}","${stagiaire.telephone}","${stagiaire.niveauEtudes}","${stagiaire.specialite}","${dateDebut}","${dateFin}"\n`;
    });
    
    res.send(csv);
  });
});

// Start server
app.listen(port, () => {
  console.log(`Serveur démarré sur le port ${port}`);
});
