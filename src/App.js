import React, { Component } from 'react';
import DynamicForm from './components/DynamicForm';
import './App.css';

class App extends Component {
  state = {
    data: [
      {id: 1, User_ID:"a", Name:"Ravi Balgi", Email:"B.Com",Mobile:3,LandLine:"male",
          City:"Kerala",Country:"India",State:"MH",LandLine:"39399349",AddressLine2:"raf",AddressLine1:"23",PinCode:"234242"},
    ],
    current: {}
  }

  onSubmit = (model) => { // function to insert into database;
    let data = [];
    console.log(model);
    if (model.id) {
      data = this.state.data.filter((d) => {
        return d.id != model.id
      });
    } else {
      model.id = +new Date();
      //data: [model, ...data];
      //data = this.state.data.slice();
    }
    
    this.setState({
      data: [model, ...data]
    });
    let temp =[];
    temp = JSON.stringify(data);
    console.log("data varaibles": temp);
  }

  onEdit = (id) => {
    let record = this.state.data.find((d) => {
      return d.id == id;
    });
    alert(JSON.stringify(record));
    this.setState({
      current: record
    })
  }

  render() {
    let data = this.state.data.map((d) => {
      return (
        <tr key={d.id}>
          <td>{d.User_ID}></td>
            <td>{d.Name}</td>
            <td>{d.Email}</td>
            <td>{d.Mobile}</td>
            <td>{d.LandLine}</td>
            <td>{d.AddressLine1}</td>
            <td>{d.AddressLine2}</td>
            <td>{d.City}</td>
            <td>{d.State}</td>
            <td>{d.Country}</td>
            <td>{d.PinCode}</td>
            
            <td><button onClick={()=>{this.onEdit(d.id)}}>edit</button></td>
        </tr>
      );
    });
    
    return (
      <div className="App">
        <DynamicForm className="form"
          title = "Registration"
          defaultValues = {this.state.current}
          model={[
            {key: "User_ID", label: "User_ID", props: {required: true}},
            {key: "Name", label: "Name", props: {required: true}},
            {key: "Email", label: "Email", props: {required: true}}, 
            {key: "Mobile", label: "Mobile", props: {required: true}},
            {key: "LandLine", label: "LandLine", props: {required: true}},
            {key: "AddressLine1", label: "AddressLine1", props: {required: true}}, 
            {key: "AddressLine2", label: "AddressLine2", props: {required: true}},
            {key: "City", label: "City", props: {required: true}},
            {key: "State", label: "State", props: {required: true}},
            {key: "Country", label: "Country", props: {required: true}},
            {key: "PinCode", label: "Pin Code", props: {required: true}},
            // {key: "TimeZone",label: "Age", type: "number"},
            // {key: "rating",label: "Rating", type: "number", props:{min:0,max:5}},
            // {key: "gender",label: "Gender", type:"radio",options:[
            //   {key:"male",label:"Male",name:"gender",value:"male"},
            //   {key:"female",label:"Female",name: "gender",value:"female"}
            //]},
            // {key: "qualification",label: "Qualification"},
            // {key: "city",label:"City", type:"select", value: "Kerala", options: [
            //     {key:"mumbai",label:"Mumbai",value:"Mumbai"},
            //     {key:"bangalore",label:"Bangalore",value:"Bangalore"},
            //     {key:"kerala",label:"Kerala",value:"Kerala"},
            // ]},
            // {key: "skills",label:"Skills", type:"checkbox", options: [
            //     {key:"reactjs",label:"ReactJS",value:"reactjs"},
            //     {key:"angular",label:"Angular",value:"angular"},
            //     {key:"vuejs",label:"VueJS",value:"vuejs"},
            // ]},

          ]}
          onSubmit = {(model) => {this.onSubmit(model)}} 
        />

        <table border="1">
          <tbody>{data}</tbody>
        </table>

      </div>
    );
  }
}

export default App;